package platform

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"
)

const monitorWorkScheduleTimezone = "Asia/Shanghai"

var monitorScheduleHistoryStart = time.Unix(0, 0).UTC()

type monitorWorkScheduleRequest struct {
	Enabled     bool  `json:"enabled"`
	StartMinute int   `json:"startMinute"`
	EndMinute   int   `json:"endMinute"`
	Weekdays    []int `json:"weekdays"`
}

type monitorWorkScheduleResponse struct {
	MonitorWorkSchedule
	Configured bool `json:"configured"`
}

func defaultMonitorWorkSchedule() MonitorWorkSchedule {
	return MonitorWorkSchedule{
		Timezone:    monitorWorkScheduleTimezone,
		StartMinute: 9 * 60,
		EndMinute:   24 * 60,
		Weekdays:    []int{1, 2, 3, 4, 5, 6, 7},
	}
}

func normalizeMonitorWorkSchedule(input MonitorWorkSchedule) (MonitorWorkSchedule, error) {
	input.Timezone = monitorWorkScheduleTimezone
	if input.StartMinute < 0 || input.StartMinute >= 24*60 {
		return MonitorWorkSchedule{}, fmt.Errorf("%w: startMinute must be between 0 and 1439", ErrInvalid)
	}
	if input.EndMinute <= 0 || input.EndMinute > 24*60 || input.EndMinute <= input.StartMinute {
		return MonitorWorkSchedule{}, fmt.Errorf("%w: endMinute must be after startMinute and no later than 1440", ErrInvalid)
	}
	seen := map[int]bool{}
	weekdays := make([]int, 0, len(input.Weekdays))
	for _, weekday := range input.Weekdays {
		if weekday < 1 || weekday > 7 || seen[weekday] {
			continue
		}
		seen[weekday] = true
		weekdays = append(weekdays, weekday)
	}
	if len(weekdays) == 0 {
		return MonitorWorkSchedule{}, fmt.Errorf("%w: at least one weekday is required", ErrInvalid)
	}
	sort.Ints(weekdays)
	input.Weekdays = weekdays
	return input, nil
}

func (s *Server) handleMonitorWorkSchedule(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if _, ok := s.requirePermission(w, r, PermissionMonitorView); !ok {
			return
		}
		settings, err := s.store.GetMonitorWorkSchedule(r.Context())
		if errors.Is(err, ErrNotFound) {
			writeJSONResponse(w, http.StatusOK, monitorWorkScheduleResponse{
				MonitorWorkSchedule: defaultMonitorWorkSchedule(),
				Configured:          false,
			})
			return
		}
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, monitorWorkScheduleResponse{
			MonitorWorkSchedule: settings,
			Configured:          true,
		})
	case http.MethodPut:
		if _, ok := s.requirePermission(w, r, PermissionMonitorSettingsManage); !ok {
			return
		}
		var input monitorWorkScheduleRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		settings, err := s.store.SaveMonitorWorkSchedule(r.Context(), MonitorWorkSchedule{
			Enabled:     input.Enabled,
			Timezone:    monitorWorkScheduleTimezone,
			StartMinute: input.StartMinute,
			EndMinute:   input.EndMinute,
			Weekdays:    input.Weekdays,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		s.monitorCacheMu.Lock()
		s.monitorCache = map[string]cachedMonitorOverview{}
		s.monitorCacheMu.Unlock()
		writeJSONResponse(w, http.StatusOK, monitorWorkScheduleResponse{
			MonitorWorkSchedule: settings,
			Configured:          true,
		})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) monitorWorkScheduleVersions(ctx context.Context) ([]MonitorWorkSchedule, error) {
	versions, err := s.store.ListMonitorWorkScheduleVersions(ctx)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(versions, func(i, j int) bool {
		return versions[i].EffectiveFrom.Before(versions[j].EffectiveFrom)
	})
	return versions, nil
}

func monitorBusinessDuration(start, end time.Time, versions []MonitorWorkSchedule) time.Duration {
	if start.IsZero() || end.IsZero() || !end.After(start) {
		return 0
	}
	current := start
	active := defaultMonitorWorkSchedule()
	active.Enabled = false
	versionIndex := 0
	for versionIndex < len(versions) && !versions[versionIndex].EffectiveFrom.After(current) {
		active = versions[versionIndex]
		versionIndex++
	}
	var total time.Duration
	for current.Before(end) {
		segmentEnd := end
		if versionIndex < len(versions) && versions[versionIndex].EffectiveFrom.Before(segmentEnd) {
			segmentEnd = versions[versionIndex].EffectiveFrom
		}
		total += monitorScheduleDuration(current, segmentEnd, active)
		current = segmentEnd
		for versionIndex < len(versions) && !versions[versionIndex].EffectiveFrom.After(current) {
			active = versions[versionIndex]
			versionIndex++
		}
	}
	return total
}

func monitorScheduleDuration(start, end time.Time, schedule MonitorWorkSchedule) time.Duration {
	if !end.After(start) {
		return 0
	}
	if !schedule.Enabled {
		return end.Sub(start)
	}
	enabledDays := make(map[int]bool, len(schedule.Weekdays))
	for _, weekday := range schedule.Weekdays {
		enabledDays[weekday] = true
	}
	location := shanghaiLocation()
	localStart := start.In(location)
	localEnd := end.In(location)
	day := time.Date(localStart.Year(), localStart.Month(), localStart.Day(), 0, 0, 0, 0, location)
	lastDay := time.Date(localEnd.Year(), localEnd.Month(), localEnd.Day(), 0, 0, 0, 0, location)
	var total time.Duration
	for !day.After(lastDay) {
		if enabledDays[isoWeekday(day.Weekday())] {
			windowStart := day.Add(time.Duration(schedule.StartMinute) * time.Minute)
			windowEnd := day.Add(time.Duration(schedule.EndMinute) * time.Minute)
			overlapStart := start
			if windowStart.After(overlapStart) {
				overlapStart = windowStart
			}
			overlapEnd := end
			if windowEnd.Before(overlapEnd) {
				overlapEnd = windowEnd
			}
			if overlapEnd.After(overlapStart) {
				total += overlapEnd.Sub(overlapStart)
			}
		}
		day = day.AddDate(0, 0, 1)
	}
	return total
}

func isoWeekday(weekday time.Weekday) int {
	if weekday == time.Sunday {
		return 7
	}
	return int(weekday)
}
