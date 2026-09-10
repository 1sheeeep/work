package platform

import (
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

const (
	statisticsConversation = "conversation"
	statisticsCustomer     = "customer"
	statisticsAgent        = "agent"
	statisticsSkillGroup   = "skill"
	statisticsService      = "service"
	statisticsSLA          = "sla"
)

type historicalStatMetric struct {
	Key   string  `json:"key"`
	Label string  `json:"label"`
	Value float64 `json:"value"`
	Unit  string  `json:"unit"`
	Note  string  `json:"note,omitempty"`
}

type historicalStatSeries struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Unit  string `json:"unit"`
}

type historicalStatTrendPoint struct {
	Date   string             `json:"date"`
	Values map[string]float64 `json:"values"`
}

type historicalStatColumn struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Unit  string `json:"unit"`
}

type historicalStatBreakdown struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Secondary string             `json:"secondary,omitempty"`
	Values    map[string]float64 `json:"values"`
}

type historicalStatisticsResponse struct {
	View        string                     `json:"view"`
	StartDate   string                     `json:"startDate"`
	EndDate     string                     `json:"endDate"`
	DateBasis   string                     `json:"dateBasis"`
	Summary     []historicalStatMetric     `json:"summary"`
	TrendSeries []historicalStatSeries     `json:"trendSeries"`
	Trend       []historicalStatTrendPoint `json:"trend"`
	Columns     []historicalStatColumn     `json:"columns"`
	Breakdown   []historicalStatBreakdown  `json:"breakdown"`
	SLASettings *SLASettings               `json:"slaSettings,omitempty"`
}

type historicalStatisticsFilter struct {
	View         string
	StartDate    string
	EndDate      string
	Start        time.Time
	EndExclusive time.Time
	ShopID       string
	AgentID      string
	SkillGroup   string
	Channel      string
}

type historicalStatisticsData struct {
	Filter           historicalStatisticsFilter
	Conversations    []Conversation
	AllConversations []Conversation
	Samples          []ResponseSample
	SamplesByConv    map[string][]ResponseSample
	ShopsByID        map[string]Shop
	UsersByID        map[string]User
	SourcesByID      map[string]ShopSource
	ScheduleVersions []MonitorWorkSchedule
	SLASettings      SLASettings
}

func defaultSLASettings() SLASettings {
	return SLASettings{
		FirstResponseMinutes: 30,
		ResponseMinutes:      30,
		ResolutionMinutes:    24 * 60,
	}
}

func normalizeSLASettings(input SLASettings) (SLASettings, error) {
	const maxMinutes = 365 * 24 * 60
	if input.FirstResponseMinutes <= 0 || input.FirstResponseMinutes > maxMinutes {
		return SLASettings{}, fmt.Errorf("%w: firstResponseMinutes must be between 1 and %d", ErrInvalid, maxMinutes)
	}
	if input.ResponseMinutes <= 0 || input.ResponseMinutes > maxMinutes {
		return SLASettings{}, fmt.Errorf("%w: responseMinutes must be between 1 and %d", ErrInvalid, maxMinutes)
	}
	if input.ResolutionMinutes <= 0 || input.ResolutionMinutes > maxMinutes {
		return SLASettings{}, fmt.Errorf("%w: resolutionMinutes must be between 1 and %d", ErrInvalid, maxMinutes)
	}
	return input, nil
}

func (s *Server) handleSLASettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if _, ok := s.requirePermission(w, r, PermissionMonitorView); !ok {
			return
		}
		settings, err := s.store.GetSLASettings(r.Context())
		if err == ErrNotFound {
			settings = defaultSLASettings()
		} else if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, settings)
	case http.MethodPut:
		if _, ok := s.requirePermission(w, r, PermissionMonitorSettingsManage); !ok {
			return
		}
		var input SLASettings
		if !decodeJSON(w, r, &input) {
			return
		}
		settings, err := s.store.SaveSLASettings(r.Context(), input)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, settings)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleHistoricalStatistics(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionMonitorView)
	if !ok {
		return
	}
	response, err := s.historicalStatistics(r, user)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, response)
}

func (s *Server) handleHistoricalStatisticsExport(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionMonitorView)
	if !ok {
		return
	}
	response, err := s.historicalStatistics(r, user)
	if err != nil {
		writeError(w, err)
		return
	}
	content, err := buildHistoricalStatisticsWorkbook(response)
	if err != nil {
		writeError(w, fmt.Errorf("build statistics workbook: %w", err))
		return
	}
	filename := fmt.Sprintf("Xzdesk_%s_%s_%s.xlsx", historicalStatisticsViewLabel(response.View), response.StartDate, response.EndDate)
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.QueryEscape(filename)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func (s *Server) historicalStatistics(r *http.Request, user User) (historicalStatisticsResponse, error) {
	filter, err := parseHistoricalStatisticsFilter(r)
	if err != nil {
		return historicalStatisticsResponse{}, err
	}
	data, err := s.loadHistoricalStatisticsData(r, user, filter)
	if err != nil {
		return historicalStatisticsResponse{}, err
	}
	switch filter.View {
	case statisticsConversation:
		return conversationStatistics(data), nil
	case statisticsCustomer:
		return customerStatistics(data), nil
	case statisticsAgent:
		return agentStatistics(data), nil
	case statisticsSkillGroup:
		return skillGroupStatistics(data), nil
	case statisticsService:
		return serviceStatistics(data), nil
	case statisticsSLA:
		return slaStatistics(data), nil
	default:
		return historicalStatisticsResponse{}, ErrInvalid
	}
}

func parseHistoricalStatisticsFilter(r *http.Request) (historicalStatisticsFilter, error) {
	query := r.URL.Query()
	filter := historicalStatisticsFilter{
		View:       strings.ToLower(strings.TrimSpace(query.Get("view"))),
		StartDate:  strings.TrimSpace(query.Get("startDate")),
		EndDate:    strings.TrimSpace(query.Get("endDate")),
		ShopID:     strings.TrimSpace(query.Get("shopId")),
		AgentID:    strings.TrimSpace(query.Get("agentId")),
		SkillGroup: strings.TrimSpace(query.Get("skillGroup")),
		Channel:    strings.ToLower(strings.TrimSpace(query.Get("channel"))),
	}
	switch filter.View {
	case statisticsConversation, statisticsCustomer, statisticsAgent, statisticsSkillGroup, statisticsService, statisticsSLA:
	default:
		return historicalStatisticsFilter{}, ErrInvalid
	}
	if filter.StartDate == "" || filter.EndDate == "" {
		return historicalStatisticsFilter{}, fmt.Errorf("%w: startDate and endDate are required", ErrInvalid)
	}
	location := shanghaiLocation()
	start, err := time.ParseInLocation("2006-01-02", filter.StartDate, location)
	if err != nil {
		return historicalStatisticsFilter{}, ErrInvalid
	}
	end, err := time.ParseInLocation("2006-01-02", filter.EndDate, location)
	if err != nil || end.Before(start) {
		return historicalStatisticsFilter{}, ErrInvalid
	}
	if filter.Channel != "" && filter.Channel != "chat" && filter.Channel != "email" {
		return historicalStatisticsFilter{}, ErrInvalid
	}
	if !validMonitorSkillGroup(filter.SkillGroup) {
		return historicalStatisticsFilter{}, ErrInvalid
	}
	filter.Start = start.UTC()
	filter.EndExclusive = end.AddDate(0, 0, 1).UTC()
	return filter, nil
}

func (s *Server) loadHistoricalStatisticsData(r *http.Request, user User, filter historicalStatisticsFilter) (historicalStatisticsData, error) {
	shops, err := s.store.ListShops(r.Context())
	if err != nil {
		return historicalStatisticsData{}, err
	}
	shops = filterActiveShops(shops)
	if effectiveModuleScope(user, DataScopeMonitor) == AccessScopeAssigned {
		allowed, listErr := s.store.ListUserShopIDs(r.Context(), user.ID)
		if listErr != nil {
			return historicalStatisticsData{}, listErr
		}
		shops = filterShopsByIDs(shops, allowed)
	}
	shopsByID := make(map[string]Shop, len(shops))
	for _, shop := range shops {
		shopsByID[shop.ID] = shop
	}
	if filter.ShopID != "" {
		if _, ok := shopsByID[filter.ShopID]; !ok {
			return historicalStatisticsData{}, ErrNotFound
		}
	}

	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		return historicalStatisticsData{}, err
	}
	usersByID := make(map[string]User, len(users))
	for _, item := range users {
		usersByID[item.ID] = item
	}
	if filter.AgentID != "" {
		selected, ok := usersByID[filter.AgentID]
		if !ok || !userIsCustomerServiceAgent(selected) {
			return historicalStatisticsData{}, ErrInvalid
		}
	}

	sources, err := s.store.ListShopSources(r.Context(), "")
	if err != nil {
		return historicalStatisticsData{}, err
	}
	sourcesByID := make(map[string]ShopSource, len(sources))
	for _, source := range sources {
		sourcesByID[source.ID] = source
	}
	conversations, err := s.listOperationalCustomerConversations(r.Context(), ConversationFilter{})
	if err != nil {
		return historicalStatisticsData{}, err
	}
	conversations, err = s.filterConversationsForModuleScope(r.Context(), user, DataScopeMonitor, conversations)
	if err != nil {
		return historicalStatisticsData{}, err
	}

	samples, err := s.store.ListResponseSamples(r.Context())
	if err != nil {
		return historicalStatisticsData{}, err
	}
	samplesByConv := make(map[string][]ResponseSample)
	for _, sample := range samples {
		samplesByConv[sample.ConversationID] = append(samplesByConv[sample.ConversationID], sample)
	}

	allAccessible := make([]Conversation, 0, len(conversations))
	filtered := make([]Conversation, 0, len(conversations))
	for _, conversation := range conversations {
		if _, ok := shopsByID[conversation.ShopID]; !ok {
			continue
		}
		sourceType := monitorSourceType(sourcesByID[conversation.SourceID].Type)
		if filter.Channel != "" && sourceType != filter.Channel {
			continue
		}
		if filter.ShopID != "" && conversation.ShopID != filter.ShopID {
			continue
		}
		allAccessible = append(allAccessible, conversation)
		if filter.AgentID != "" && !conversationInvolvesAgent(conversation, samplesByConv[conversation.ID], filter.AgentID) {
			continue
		}
		if filter.SkillGroup != "" && !conversationInvolvesSkillGroup(conversation, samplesByConv[conversation.ID], filter.SkillGroup, usersByID) {
			continue
		}
		filtered = append(filtered, conversation)
	}
	filteredIDs := make(map[string]bool, len(filtered))
	for _, conversation := range filtered {
		filteredIDs[conversation.ID] = true
	}
	filteredSamples := make([]ResponseSample, 0, len(samples))
	for _, sample := range samples {
		if !filteredIDs[sample.ConversationID] {
			continue
		}
		if filter.AgentID != "" && sample.AgentID != filter.AgentID {
			continue
		}
		if filter.SkillGroup != "" {
			agent := usersByID[sample.AgentID]
			if agent.Role != UserRoleAgent || agent.SkillGroup != filter.SkillGroup {
				continue
			}
		}
		filteredSamples = append(filteredSamples, sample)
	}

	scheduleVersions, err := s.monitorWorkScheduleVersions(r.Context())
	if err != nil {
		return historicalStatisticsData{}, err
	}
	slaSettings, err := s.store.GetSLASettings(r.Context())
	if err == ErrNotFound {
		slaSettings = defaultSLASettings()
	} else if err != nil {
		return historicalStatisticsData{}, err
	}
	return historicalStatisticsData{
		Filter: filter, Conversations: filtered, AllConversations: allAccessible,
		Samples: filteredSamples, SamplesByConv: samplesByConv,
		ShopsByID: shopsByID, UsersByID: usersByID, SourcesByID: sourcesByID,
		ScheduleVersions: scheduleVersions, SLASettings: slaSettings,
	}, nil
}

func conversationInvolvesAgent(conversation Conversation, samples []ResponseSample, agentID string) bool {
	if conversation.AssignedAgentID == agentID {
		return true
	}
	for _, sample := range samples {
		if sample.AgentID == agentID {
			return true
		}
	}
	return false
}

func conversationInvolvesSkillGroup(conversation Conversation, samples []ResponseSample, skillGroup string, users map[string]User) bool {
	if agent := users[conversation.AssignedAgentID]; agent.Role == UserRoleAgent && agent.SkillGroup == skillGroup {
		return true
	}
	for _, sample := range samples {
		if agent := users[sample.AgentID]; agent.Role == UserRoleAgent && agent.SkillGroup == skillGroup {
			return true
		}
	}
	return false
}

func baseHistoricalStatisticsResponse(data historicalStatisticsData) historicalStatisticsResponse {
	return historicalStatisticsResponse{
		View: data.Filter.View, StartDate: data.Filter.StartDate, EndDate: data.Filter.EndDate,
		DateBasis: "北京时间；会话量按创建时间、完成量按结束时间、响应量按回复时间统计",
		Summary:   []historicalStatMetric{}, TrendSeries: []historicalStatSeries{},
		Trend: historicalTrendRange(data.Filter), Columns: []historicalStatColumn{}, Breakdown: []historicalStatBreakdown{},
	}
}

func historicalTrendRange(filter historicalStatisticsFilter) []historicalStatTrendPoint {
	location := shanghaiLocation()
	current := filter.Start.In(location)
	end := filter.EndExclusive.In(location)
	out := make([]historicalStatTrendPoint, 0)
	for current.Before(end) {
		out = append(out, historicalStatTrendPoint{Date: current.Format("2006-01-02"), Values: map[string]float64{}})
		current = current.AddDate(0, 0, 1)
	}
	return out
}

func trendPointByDate(response *historicalStatisticsResponse) map[string]*historicalStatTrendPoint {
	out := make(map[string]*historicalStatTrendPoint, len(response.Trend))
	for index := range response.Trend {
		out[response.Trend[index].Date] = &response.Trend[index]
	}
	return out
}

func eventDate(value time.Time) string {
	return value.In(shanghaiLocation()).Format("2006-01-02")
}

func inHistoricalRange(value time.Time, filter historicalStatisticsFilter) bool {
	return !value.IsZero() && !value.Before(filter.Start) && value.Before(filter.EndExclusive)
}

func conversationClosedAt(conversation Conversation) time.Time {
	if !conversation.ClosedAt.IsZero() {
		return conversation.ClosedAt
	}
	if conversation.Status == ConversationStatusClosed {
		return conversation.UpdatedAt
	}
	return time.Time{}
}

func eligibleStatisticsAgent(user User) bool {
	return userIsCustomerServiceAgent(user)
}

func eligibleResponseSamples(data historicalStatisticsData, inRangeOnly bool) []ResponseSample {
	out := make([]ResponseSample, 0, len(data.Samples))
	for _, sample := range data.Samples {
		if !eligibleStatisticsAgent(data.UsersByID[sample.AgentID]) {
			continue
		}
		if inRangeOnly && !inHistoricalRange(sample.EndedAt, data.Filter) {
			continue
		}
		out = append(out, sample)
	}
	return out
}

func responseSampleSeconds(sample ResponseSample, versions []MonitorWorkSchedule) float64 {
	if !sample.StartedAt.IsZero() && !sample.EndedAt.IsZero() {
		return monitorBusinessDuration(sample.StartedAt, sample.EndedAt, versions).Seconds()
	}
	return sample.Seconds
}

func average(total float64, count int) float64 {
	if count == 0 {
		return 0
	}
	return total / float64(count)
}

func percentage(hit int, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(hit) * 100 / float64(total)
}

func conversationStatistics(data historicalStatisticsData) historicalStatisticsResponse {
	response := baseHistoricalStatisticsResponse(data)
	response.TrendSeries = []historicalStatSeries{
		{Key: "created", Label: "新建会话", Unit: "count"},
		{Key: "closed", Label: "结束会话", Unit: "count"},
	}
	trend := trendPointByDate(&response)
	created := make([]Conversation, 0)
	closedCount := 0
	handled := 0
	channelRows := map[string]*historicalStatBreakdown{}
	for _, conversation := range data.Conversations {
		if inHistoricalRange(conversation.CreatedAt, data.Filter) {
			created = append(created, conversation)
			trend[eventDate(conversation.CreatedAt)].Values["created"]++
			if conversation.AssignedAgentID != "" || len(data.SamplesByConv[conversation.ID]) > 0 {
				handled++
			}
			channel := monitorSourceType(data.SourcesByID[conversation.SourceID].Type)
			row := channelRows[channel]
			if row == nil {
				row = &historicalStatBreakdown{ID: channel, Name: historicalChannelLabel(channel), Values: map[string]float64{}}
				channelRows[channel] = row
			}
			row.Values["created"]++
		}
		closedAt := conversationClosedAt(conversation)
		if inHistoricalRange(closedAt, data.Filter) {
			closedCount++
			trend[eventDate(closedAt)].Values["closed"]++
			channel := monitorSourceType(data.SourcesByID[conversation.SourceID].Type)
			row := channelRows[channel]
			if row == nil {
				row = &historicalStatBreakdown{ID: channel, Name: historicalChannelLabel(channel), Values: map[string]float64{}}
				channelRows[channel] = row
			}
			row.Values["closed"]++
		}
	}
	var responseTotal, firstTotal float64
	var responseCount, firstCount int
	for _, sample := range eligibleResponseSamples(data, true) {
		seconds := responseSampleSeconds(sample, data.ScheduleVersions)
		responseTotal += seconds
		responseCount++
		if sample.First {
			firstTotal += seconds
			firstCount++
		}
	}
	response.Summary = []historicalStatMetric{
		{Key: "created", Label: "新建会话", Value: float64(len(created)), Unit: "count", Note: "筛选期内创建"},
		{Key: "handled", Label: "已接待会话", Value: float64(handled), Unit: "count", Note: "包含管理员处理的业务量"},
		{Key: "closed", Label: "结束会话", Value: float64(closedCount), Unit: "count", Note: "筛选期内结束"},
		{Key: "firstResponse", Label: "平均首响", Value: average(firstTotal, firstCount), Unit: "seconds", Note: "仅统计客服回复"},
		{Key: "response", Label: "平均响应", Value: average(responseTotal, responseCount), Unit: "seconds", Note: "按统计工作时间"},
	}
	response.Columns = []historicalStatColumn{
		{Key: "created", Label: "新建会话", Unit: "count"},
		{Key: "closed", Label: "已结束", Unit: "count"},
	}
	for _, key := range []string{"chat", "email"} {
		if row := channelRows[key]; row != nil {
			response.Breakdown = append(response.Breakdown, *row)
		}
	}
	return response
}

func customerStatistics(data historicalStatisticsData) historicalStatisticsResponse {
	response := baseHistoricalStatisticsResponse(data)
	response.TrendSeries = []historicalStatSeries{
		{Key: "customers", Label: "活跃客户", Unit: "count"},
		{Key: "conversations", Label: "客户会话", Unit: "count"},
	}
	trend := trendPointByDate(&response)
	earliest := map[string]time.Time{}
	for _, conversation := range data.AllConversations {
		key := historicalCustomerKey(conversation)
		if current, ok := earliest[key]; !ok || conversation.CreatedAt.Before(current) {
			earliest[key] = conversation.CreatedAt
		}
	}
	type customerAggregate struct {
		key, name, email string
		conversations    int
		closed           int
	}
	customers := map[string]*customerAggregate{}
	dailyCustomers := map[string]map[string]bool{}
	for _, conversation := range data.Conversations {
		if !inHistoricalRange(conversation.CreatedAt, data.Filter) {
			continue
		}
		key := historicalCustomerKey(conversation)
		item := customers[key]
		if item == nil {
			item = &customerAggregate{key: key, name: defaultString(strings.TrimSpace(conversation.CustomerName), "未识别客户"), email: normalizeEmail(conversation.CustomerEmail)}
			customers[key] = item
		}
		item.conversations++
		if conversation.Status == ConversationStatusClosed {
			item.closed++
		}
		date := eventDate(conversation.CreatedAt)
		if dailyCustomers[date] == nil {
			dailyCustomers[date] = map[string]bool{}
		}
		dailyCustomers[date][key] = true
		trend[date].Values["conversations"]++
	}
	newCustomers, repeatCustomers := 0, 0
	totalConversations := 0
	for key, item := range customers {
		if !earliest[key].Before(data.Filter.Start) {
			newCustomers++
		}
		if item.conversations > 1 {
			repeatCustomers++
		}
		totalConversations += item.conversations
		response.Breakdown = append(response.Breakdown, historicalStatBreakdown{
			ID: key, Name: item.name, Secondary: item.email,
			Values: map[string]float64{"conversations": float64(item.conversations), "closed": float64(item.closed)},
		})
	}
	for date, unique := range dailyCustomers {
		trend[date].Values["customers"] = float64(len(unique))
	}
	sort.Slice(response.Breakdown, func(i, j int) bool {
		return response.Breakdown[i].Values["conversations"] > response.Breakdown[j].Values["conversations"]
	})
	if len(response.Breakdown) > 100 {
		response.Breakdown = response.Breakdown[:100]
	}
	response.Summary = []historicalStatMetric{
		{Key: "customers", Label: "客户数", Value: float64(len(customers)), Unit: "count", Note: "同店铺邮箱去重"},
		{Key: "new", Label: "新客户", Value: float64(newCustomers), Unit: "count", Note: "首次会话发生在筛选期"},
		{Key: "repeat", Label: "回访客户", Value: float64(repeatCustomers), Unit: "count", Note: "筛选期内产生多次会话"},
		{Key: "conversations", Label: "客户会话", Value: float64(totalConversations), Unit: "count"},
	}
	response.Columns = []historicalStatColumn{
		{Key: "conversations", Label: "会话数", Unit: "count"},
		{Key: "closed", Label: "已结束", Unit: "count"},
	}
	return response
}

func historicalCustomerKey(conversation Conversation) string {
	email := normalizeEmail(conversation.CustomerEmail)
	if email == "" {
		return "conversation|" + conversation.ID
	}
	return conversation.ShopID + "|" + email
}

type personnelAggregate struct {
	ID                  string
	Name                string
	Secondary           string
	Handled             map[string]bool
	Replies             int
	Closed              int
	ResponseTotal       float64
	ResponseCount       int
	FirstTotal          float64
	FirstCount          int
	FirstSLAAchieved    int
	ResponseSLAAchieved int
}

func agentStatistics(data historicalStatisticsData) historicalStatisticsResponse {
	response := baseHistoricalStatisticsResponse(data)
	response.TrendSeries = []historicalStatSeries{
		{Key: "replies", Label: "客服回复", Unit: "count"},
		{Key: "closed", Label: "结束会话", Unit: "count"},
	}
	trend := trendPointByDate(&response)
	aggregates := map[string]*personnelAggregate{}
	ensure := func(agentID string) *personnelAggregate {
		user := data.UsersByID[agentID]
		if !eligibleStatisticsAgent(user) {
			return nil
		}
		item := aggregates[agentID]
		if item == nil {
			item = &personnelAggregate{
				ID: agentID, Name: defaultString(strings.TrimSpace(user.DisplayName), user.Email),
				Secondary: user.SkillGroup, Handled: map[string]bool{},
			}
			aggregates[agentID] = item
		}
		return item
	}
	for _, sample := range eligibleResponseSamples(data, true) {
		item := ensure(sample.AgentID)
		if item == nil {
			continue
		}
		seconds := responseSampleSeconds(sample, data.ScheduleVersions)
		item.Handled[sample.ConversationID] = true
		item.Replies++
		item.ResponseTotal += seconds
		item.ResponseCount++
		if seconds <= float64(data.SLASettings.ResponseMinutes*60) {
			item.ResponseSLAAchieved++
		}
		if sample.First {
			item.FirstTotal += seconds
			item.FirstCount++
			if seconds <= float64(data.SLASettings.FirstResponseMinutes*60) {
				item.FirstSLAAchieved++
			}
		}
		trend[eventDate(sample.EndedAt)].Values["replies"]++
	}
	for _, conversation := range data.Conversations {
		closedAt := conversationClosedAt(conversation)
		if !inHistoricalRange(closedAt, data.Filter) {
			continue
		}
		if item := ensure(conversation.AssignedAgentID); item != nil {
			item.Closed++
			trend[eventDate(closedAt)].Values["closed"]++
		}
	}
	var handledUnion = map[string]bool{}
	var responseTotal, firstTotal float64
	var replies, responseCount, firstCount, closed int
	for _, item := range aggregates {
		for conversationID := range item.Handled {
			handledUnion[conversationID] = true
		}
		replies += item.Replies
		closed += item.Closed
		responseTotal += item.ResponseTotal
		responseCount += item.ResponseCount
		firstTotal += item.FirstTotal
		firstCount += item.FirstCount
		response.Breakdown = append(response.Breakdown, personnelBreakdown(*item))
	}
	sort.Slice(response.Breakdown, func(i, j int) bool {
		return response.Breakdown[i].Values["handled"] > response.Breakdown[j].Values["handled"]
	})
	response.Summary = []historicalStatMetric{
		{Key: "agents", Label: "参与客服", Value: float64(len(aggregates)), Unit: "count", Note: "不包含管理员账号"},
		{Key: "handled", Label: "接待会话", Value: float64(len(handledUnion)), Unit: "count"},
		{Key: "replies", Label: "客服回复", Value: float64(replies), Unit: "count"},
		{Key: "closed", Label: "完成会话", Value: float64(closed), Unit: "count"},
		{Key: "firstResponse", Label: "平均首响", Value: average(firstTotal, firstCount), Unit: "seconds"},
		{Key: "response", Label: "平均响应", Value: average(responseTotal, responseCount), Unit: "seconds"},
	}
	response.Columns = personnelColumns()
	return response
}

func personnelBreakdown(item personnelAggregate) historicalStatBreakdown {
	return historicalStatBreakdown{
		ID: item.ID, Name: item.Name, Secondary: item.Secondary,
		Values: map[string]float64{
			"handled":       float64(len(item.Handled)),
			"replies":       float64(item.Replies),
			"closed":        float64(item.Closed),
			"firstResponse": average(item.FirstTotal, item.FirstCount),
			"response":      average(item.ResponseTotal, item.ResponseCount),
			"firstSLA":      percentage(item.FirstSLAAchieved, item.FirstCount),
			"responseSLA":   percentage(item.ResponseSLAAchieved, item.ResponseCount),
		},
	}
}

func personnelColumns() []historicalStatColumn {
	return []historicalStatColumn{
		{Key: "handled", Label: "接待会话", Unit: "count"},
		{Key: "replies", Label: "回复数", Unit: "count"},
		{Key: "closed", Label: "完成会话", Unit: "count"},
		{Key: "firstResponse", Label: "平均首响", Unit: "seconds"},
		{Key: "response", Label: "平均响应", Unit: "seconds"},
		{Key: "firstSLA", Label: "首响达标率", Unit: "percent"},
		{Key: "responseSLA", Label: "回复达标率", Unit: "percent"},
	}
}

func skillGroupStatistics(data historicalStatisticsData) historicalStatisticsResponse {
	response := baseHistoricalStatisticsResponse(data)
	response.TrendSeries = []historicalStatSeries{
		{Key: "consulting", Label: SkillGroupConsulting, Unit: "count"},
		{Key: "afterSales", Label: SkillGroupAfterSales, Unit: "count"},
	}
	trend := trendPointByDate(&response)
	aggregates := map[string]*personnelAggregate{}
	for _, group := range []string{SkillGroupConsulting, SkillGroupAfterSales} {
		if data.Filter.SkillGroup == "" || data.Filter.SkillGroup == group {
			aggregates[group] = &personnelAggregate{ID: group, Name: group, Secondary: "技能组", Handled: map[string]bool{}}
		}
	}
	for _, sample := range eligibleResponseSamples(data, true) {
		user := data.UsersByID[sample.AgentID]
		item := aggregates[user.SkillGroup]
		if item == nil {
			continue
		}
		seconds := responseSampleSeconds(sample, data.ScheduleVersions)
		item.Handled[sample.ConversationID] = true
		item.Replies++
		item.ResponseTotal += seconds
		item.ResponseCount++
		if seconds <= float64(data.SLASettings.ResponseMinutes*60) {
			item.ResponseSLAAchieved++
		}
		if sample.First {
			item.FirstTotal += seconds
			item.FirstCount++
			if seconds <= float64(data.SLASettings.FirstResponseMinutes*60) {
				item.FirstSLAAchieved++
			}
		}
		seriesKey := "consulting"
		if user.SkillGroup == SkillGroupAfterSales {
			seriesKey = "afterSales"
		}
		trend[eventDate(sample.EndedAt)].Values[seriesKey]++
	}
	for _, conversation := range data.Conversations {
		closedAt := conversationClosedAt(conversation)
		if !inHistoricalRange(closedAt, data.Filter) {
			continue
		}
		user := data.UsersByID[conversation.AssignedAgentID]
		if !eligibleStatisticsAgent(user) {
			continue
		}
		if item := aggregates[user.SkillGroup]; item != nil {
			item.Closed++
		}
	}
	var handled = map[string]bool{}
	var replies, closed int
	var responseTotal, firstTotal float64
	var responseCount, firstCount int
	for _, group := range []string{SkillGroupConsulting, SkillGroupAfterSales} {
		item := aggregates[group]
		if item == nil {
			continue
		}
		for conversationID := range item.Handled {
			handled[conversationID] = true
		}
		replies += item.Replies
		closed += item.Closed
		responseTotal += item.ResponseTotal
		responseCount += item.ResponseCount
		firstTotal += item.FirstTotal
		firstCount += item.FirstCount
		response.Breakdown = append(response.Breakdown, personnelBreakdown(*item))
	}
	response.Summary = []historicalStatMetric{
		{Key: "groups", Label: "技能组", Value: float64(len(response.Breakdown)), Unit: "count"},
		{Key: "handled", Label: "接待会话", Value: float64(len(handled)), Unit: "count"},
		{Key: "replies", Label: "客服回复", Value: float64(replies), Unit: "count"},
		{Key: "closed", Label: "完成会话", Value: float64(closed), Unit: "count"},
		{Key: "firstResponse", Label: "平均首响", Value: average(firstTotal, firstCount), Unit: "seconds"},
		{Key: "response", Label: "平均响应", Value: average(responseTotal, responseCount), Unit: "seconds"},
	}
	response.Columns = personnelColumns()
	return response
}

func serviceStatistics(data historicalStatisticsData) historicalStatisticsResponse {
	response := baseHistoricalStatisticsResponse(data)
	response.TrendSeries = []historicalStatSeries{
		{Key: "closed", Label: "结束会话", Unit: "count"},
		{Key: "classified", Label: "已分类", Unit: "count"},
	}
	trend := trendPointByDate(&response)
	categoryRows := map[string]*historicalStatBreakdown{}
	closedCount, classifiedCount, autoCount := 0, 0, 0
	for _, conversation := range data.Conversations {
		closedAt := conversationClosedAt(conversation)
		if !inHistoricalRange(closedAt, data.Filter) {
			continue
		}
		closedCount++
		date := eventDate(closedAt)
		trend[date].Values["closed"]++
		if !conversation.RecordClassified {
			continue
		}
		classifiedCount++
		trend[date].Values["classified"]++
		if conversation.RecordAutoFilled {
			autoCount++
		}
		primary := defaultString(strings.TrimSpace(conversation.RecordPrimary), "其他")
		secondary := strings.TrimSpace(conversation.RecordSecondary)
		tertiary := strings.TrimSpace(conversation.RecordTertiary)
		path := strings.Join([]string{primary, secondary, tertiary}, "\x00")
		row := categoryRows[path]
		if row == nil {
			detail := strings.Join(nonEmptyHistoricalStrings(secondary, tertiary), " · ")
			row = &historicalStatBreakdown{ID: path, Name: primary, Secondary: detail, Values: map[string]float64{}}
			categoryRows[path] = row
		}
		row.Values["closed"]++
		if conversation.RecordAutoFilled {
			row.Values["automatic"]++
		} else {
			row.Values["manual"]++
		}
	}
	for _, row := range categoryRows {
		row.Values["share"] = percentage(int(row.Values["closed"]), classifiedCount)
		response.Breakdown = append(response.Breakdown, *row)
	}
	sort.Slice(response.Breakdown, func(i, j int) bool {
		return response.Breakdown[i].Values["closed"] > response.Breakdown[j].Values["closed"]
	})
	response.Summary = []historicalStatMetric{
		{Key: "closed", Label: "结束会话", Value: float64(closedCount), Unit: "count"},
		{Key: "classified", Label: "已分类", Value: float64(classifiedCount), Unit: "count"},
		{Key: "unclassified", Label: "未分类", Value: float64(closedCount - classifiedCount), Unit: "count", Note: "单独展示避免漏数"},
		{Key: "coverage", Label: "分类覆盖率", Value: percentage(classifiedCount, closedCount), Unit: "percent"},
		{Key: "automatic", Label: "自动分类", Value: float64(autoCount), Unit: "count"},
	}
	response.Columns = []historicalStatColumn{
		{Key: "closed", Label: "已分类会话", Unit: "count"},
		{Key: "manual", Label: "人工分类", Unit: "count"},
		{Key: "automatic", Label: "自动分类", Unit: "count"},
		{Key: "share", Label: "分类占比", Unit: "percent"},
	}
	return response
}

type slaAggregate struct {
	ID                 string
	Name               string
	FirstAchieved      int
	FirstOverdue       int
	FirstPending       int
	ResponseAchieved   int
	ResponseOverdue    int
	ResolutionAchieved int
	ResolutionOverdue  int
	ResolutionPending  int
}

func slaStatistics(data historicalStatisticsData) historicalStatisticsResponse {
	response := baseHistoricalStatisticsResponse(data)
	settings := data.SLASettings
	response.SLASettings = &settings
	response.TrendSeries = []historicalStatSeries{
		{Key: "firstSLA", Label: "首响达标率", Unit: "percent"},
		{Key: "responseSLA", Label: "回复达标率", Unit: "percent"},
		{Key: "resolutionSLA", Label: "解决达标率", Unit: "percent"},
	}
	trend := trendPointByDate(&response)
	now := time.Now().UTC()
	if now.After(data.Filter.EndExclusive) {
		now = data.Filter.EndExclusive
	}
	firstByConversation := map[string]ResponseSample{}
	for _, sample := range eligibleResponseSamples(data, false) {
		if !sample.First {
			continue
		}
		current, ok := firstByConversation[sample.ConversationID]
		if !ok || sample.EndedAt.Before(current.EndedAt) {
			firstByConversation[sample.ConversationID] = sample
		}
	}
	shops := map[string]*slaAggregate{}
	ensureShop := func(shopID string) *slaAggregate {
		item := shops[shopID]
		if item == nil {
			item = &slaAggregate{ID: shopID, Name: defaultString(data.ShopsByID[shopID].DisplayName, shopID)}
			shops[shopID] = item
		}
		return item
	}
	type daySLA struct {
		firstHit, firstTotal, responseHit, responseTotal, resolutionHit, resolutionTotal int
	}
	daily := map[string]*daySLA{}
	day := func(date string) *daySLA {
		item := daily[date]
		if item == nil {
			item = &daySLA{}
			daily[date] = item
		}
		return item
	}
	for _, conversation := range data.Conversations {
		if !inHistoricalRange(conversation.CreatedAt, data.Filter) {
			continue
		}
		row := ensureShop(conversation.ShopID)
		date := eventDate(conversation.CreatedAt)
		dailyItem := day(date)
		if sample, ok := firstByConversation[conversation.ID]; ok {
			seconds := responseSampleSeconds(sample, data.ScheduleVersions)
			dailyItem.firstTotal++
			if seconds <= float64(settings.FirstResponseMinutes*60) {
				row.FirstAchieved++
				dailyItem.firstHit++
			} else {
				row.FirstOverdue++
			}
		} else {
			elapsed := monitorBusinessDuration(conversation.CreatedAt, now, data.ScheduleVersions)
			if elapsed > time.Duration(settings.FirstResponseMinutes)*time.Minute {
				row.FirstOverdue++
				dailyItem.firstTotal++
			} else {
				row.FirstPending++
			}
		}

		resolutionEnd := conversationClosedAt(conversation)
		if !resolutionEnd.IsZero() {
			seconds := monitorBusinessDuration(conversation.CreatedAt, resolutionEnd, data.ScheduleVersions).Seconds()
			dailyItem.resolutionTotal++
			if seconds <= float64(settings.ResolutionMinutes*60) {
				row.ResolutionAchieved++
				dailyItem.resolutionHit++
			} else {
				row.ResolutionOverdue++
			}
		} else {
			elapsed := monitorBusinessDuration(conversation.CreatedAt, now, data.ScheduleVersions)
			if elapsed > time.Duration(settings.ResolutionMinutes)*time.Minute {
				row.ResolutionOverdue++
				dailyItem.resolutionTotal++
			} else {
				row.ResolutionPending++
			}
		}
	}
	for _, sample := range eligibleResponseSamples(data, true) {
		if sample.First {
			continue
		}
		conversation := findConversation(data.Conversations, sample.ConversationID)
		if conversation.ID == "" {
			continue
		}
		row := ensureShop(conversation.ShopID)
		dailyItem := day(eventDate(sample.EndedAt))
		dailyItem.responseTotal++
		seconds := responseSampleSeconds(sample, data.ScheduleVersions)
		if seconds <= float64(settings.ResponseMinutes*60) {
			row.ResponseAchieved++
			dailyItem.responseHit++
		} else {
			row.ResponseOverdue++
		}
	}
	total := slaAggregate{}
	for _, row := range shops {
		total.FirstAchieved += row.FirstAchieved
		total.FirstOverdue += row.FirstOverdue
		total.FirstPending += row.FirstPending
		total.ResponseAchieved += row.ResponseAchieved
		total.ResponseOverdue += row.ResponseOverdue
		total.ResolutionAchieved += row.ResolutionAchieved
		total.ResolutionOverdue += row.ResolutionOverdue
		total.ResolutionPending += row.ResolutionPending
		response.Breakdown = append(response.Breakdown, historicalStatBreakdown{
			ID: row.ID, Name: row.Name,
			Values: map[string]float64{
				"firstSLA":          percentage(row.FirstAchieved, row.FirstAchieved+row.FirstOverdue),
				"responseSLA":       percentage(row.ResponseAchieved, row.ResponseAchieved+row.ResponseOverdue),
				"resolutionSLA":     percentage(row.ResolutionAchieved, row.ResolutionAchieved+row.ResolutionOverdue),
				"firstOverdue":      float64(row.FirstOverdue),
				"resolutionOverdue": float64(row.ResolutionOverdue),
			},
		})
	}
	sort.Slice(response.Breakdown, func(i, j int) bool {
		return response.Breakdown[i].Values["firstSLA"] < response.Breakdown[j].Values["firstSLA"]
	})
	for date, item := range daily {
		trend[date].Values["firstSLA"] = percentage(item.firstHit, item.firstTotal)
		trend[date].Values["responseSLA"] = percentage(item.responseHit, item.responseTotal)
		trend[date].Values["resolutionSLA"] = percentage(item.resolutionHit, item.resolutionTotal)
	}
	response.Summary = []historicalStatMetric{
		{Key: "firstSLA", Label: "首响达标率", Value: percentage(total.FirstAchieved, total.FirstAchieved+total.FirstOverdue), Unit: "percent", Note: fmt.Sprintf("目标 ≤ %d 分钟", settings.FirstResponseMinutes)},
		{Key: "responseSLA", Label: "回复达标率", Value: percentage(total.ResponseAchieved, total.ResponseAchieved+total.ResponseOverdue), Unit: "percent", Note: fmt.Sprintf("目标 ≤ %d 分钟", settings.ResponseMinutes)},
		{Key: "resolutionSLA", Label: "解决达标率", Value: percentage(total.ResolutionAchieved, total.ResolutionAchieved+total.ResolutionOverdue), Unit: "percent", Note: fmt.Sprintf("目标 ≤ %d 分钟", settings.ResolutionMinutes)},
		{Key: "firstOverdue", Label: "首响超时", Value: float64(total.FirstOverdue), Unit: "count"},
		{Key: "resolutionOverdue", Label: "解决超时", Value: float64(total.ResolutionOverdue), Unit: "count"},
		{Key: "pending", Label: "尚未到期", Value: float64(total.FirstPending + total.ResolutionPending), Unit: "count", Note: "不计入达标率分母"},
	}
	response.Columns = []historicalStatColumn{
		{Key: "firstSLA", Label: "首响达标率", Unit: "percent"},
		{Key: "responseSLA", Label: "回复达标率", Unit: "percent"},
		{Key: "resolutionSLA", Label: "解决达标率", Unit: "percent"},
		{Key: "firstOverdue", Label: "首响超时", Unit: "count"},
		{Key: "resolutionOverdue", Label: "解决超时", Unit: "count"},
	}
	return response
}

func findConversation(items []Conversation, id string) Conversation {
	for _, item := range items {
		if item.ID == id {
			return item
		}
	}
	return Conversation{}
}

func sumBreakdown(items []historicalStatBreakdown, key string) float64 {
	var total float64
	for _, item := range items {
		total += item.Values[key]
	}
	return total
}

func nonEmptyHistoricalStrings(items ...string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			out = append(out, strings.TrimSpace(item))
		}
	}
	return out
}

func historicalChannelLabel(channel string) string {
	if channel == "email" {
		return "邮件"
	}
	if channel == "chat" {
		return "在线聊天"
	}
	return defaultString(channel, "其他")
}

func historicalStatisticsViewLabel(view string) string {
	switch view {
	case statisticsConversation:
		return "会话统计"
	case statisticsCustomer:
		return "客户统计"
	case statisticsAgent:
		return "客服统计"
	case statisticsSkillGroup:
		return "技能组统计"
	case statisticsService:
		return "服务总结统计"
	case statisticsSLA:
		return "SLA统计"
	default:
		return "历史统计"
	}
}

func buildHistoricalStatisticsWorkbook(response historicalStatisticsResponse) ([]byte, error) {
	book := excelize.NewFile()
	defer func() { _ = book.Close() }()
	defaultSheet := book.GetSheetName(0)
	_ = book.SetSheetName(defaultSheet, "概览")
	overviewRows := [][]any{{"指标", "数值", "单位", "口径说明"}}
	for _, metric := range response.Summary {
		overviewRows = append(overviewRows, []any{metric.Label, metric.Value, historicalUnitLabel(metric.Unit), metric.Note})
	}
	overviewRows = append(overviewRows, []any{"统计日期", response.StartDate + " 至 " + response.EndDate, "", response.DateBasis})
	if err := writeStatisticsSheet(book, "概览", overviewRows); err != nil {
		return nil, err
	}
	if _, err := book.NewSheet("趋势"); err != nil {
		return nil, err
	}
	trendHeader := []any{"日期"}
	for _, series := range response.TrendSeries {
		trendHeader = append(trendHeader, historicalColumnLabel(series.Label, series.Unit))
	}
	trendRows := [][]any{trendHeader}
	for _, point := range response.Trend {
		row := []any{point.Date}
		for _, series := range response.TrendSeries {
			row = append(row, point.Values[series.Key])
		}
		trendRows = append(trendRows, row)
	}
	if err := writeStatisticsSheet(book, "趋势", trendRows); err != nil {
		return nil, err
	}
	if _, err := book.NewSheet("明细"); err != nil {
		return nil, err
	}
	breakdownHeader := []any{"名称", "补充信息"}
	for _, column := range response.Columns {
		breakdownHeader = append(breakdownHeader, historicalColumnLabel(column.Label, column.Unit))
	}
	breakdownRows := [][]any{breakdownHeader}
	for _, item := range response.Breakdown {
		row := []any{item.Name, item.Secondary}
		for _, column := range response.Columns {
			row = append(row, item.Values[column.Key])
		}
		breakdownRows = append(breakdownRows, row)
	}
	if err := writeStatisticsSheet(book, "明细", breakdownRows); err != nil {
		return nil, err
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func writeStatisticsSheet(book *excelize.File, sheet string, rows [][]any) error {
	for rowIndex, row := range rows {
		for columnIndex, value := range row {
			cell, err := excelize.CoordinatesToCellName(columnIndex+1, rowIndex+1)
			if err != nil {
				return err
			}
			if err := book.SetCellValue(sheet, cell, value); err != nil {
				return err
			}
		}
	}
	headerStyle, err := book.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true, Color: "FFFFFF"},
		Fill: excelize.Fill{Type: "pattern", Color: []string{"2563EB"}, Pattern: 1},
	})
	if err != nil {
		return err
	}
	lastColumn, _ := excelize.ColumnNumberToName(maxStatisticsColumns(rows))
	if err := book.SetCellStyle(sheet, "A1", lastColumn+"1", headerStyle); err != nil {
		return err
	}
	if err := book.SetColWidth(sheet, "A", "A", 24); err != nil {
		return err
	}
	if maxStatisticsColumns(rows) >= 2 {
		if err := book.SetColWidth(sheet, "B", lastColumn, 18); err != nil {
			return err
		}
	}
	return book.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
}

func maxStatisticsColumns(rows [][]any) int {
	maximum := 1
	for _, row := range rows {
		if len(row) > maximum {
			maximum = len(row)
		}
	}
	return maximum
}

func historicalUnitLabel(unit string) string {
	switch unit {
	case "seconds":
		return "秒"
	case "percent":
		return "%"
	default:
		return ""
	}
}

func historicalColumnLabel(label string, unit string) string {
	unitLabel := historicalUnitLabel(unit)
	if unitLabel == "" {
		return label
	}
	return fmt.Sprintf("%s（%s）", label, unitLabel)
}
