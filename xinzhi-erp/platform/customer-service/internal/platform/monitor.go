package platform

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type responseMetric struct {
	UserID             string  `json:"userId"`
	ConversationCount  int     `json:"conversationCount"`
	ResponseCount      int     `json:"responseCount"`
	AverageResponseSec float64 `json:"averageResponseSec"`
	FirstResponseSec   float64 `json:"firstResponseSec"`
}

type responseMetricsResponse struct {
	AverageResponseSec float64          `json:"averageResponseSec"`
	FirstResponseSec   float64          `json:"firstResponseSec"`
	Metrics            []responseMetric `json:"metrics"`
}

type monitorOverviewTotals struct {
	Agents         int `json:"agents"`
	Shops          int `json:"shops"`
	ActiveChannels int `json:"activeChannels"`
	Queued         int `json:"queued"`
	Assigned       int `json:"assigned"`
	EmailPending   int `json:"emailPending"`
	ClosedToday    int `json:"closedToday"`
	Anomaly        int `json:"anomaly"`
}

type monitorOverviewAgent struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Role             string   `json:"role"`
	SkillGroup       string   `json:"skillGroup,omitempty"`
	Online           bool     `json:"online"`
	ShopNames        []string `json:"shopNames"`
	Assigned         int      `json:"assigned"`
	Queued           int      `json:"queued"`
	ClosedToday      int      `json:"closedToday"`
	Anomaly          int      `json:"anomaly"`
	ReceptionLimit   int      `json:"receptionLimit"`
	ReceptionPercent int      `json:"receptionPercent"`
}

type monitorAgentOption struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	SkillGroup string `json:"skillGroup,omitempty"`
}

type monitorOverviewSkillGroup struct {
	Name        string `json:"name"`
	Agents      int    `json:"agents"`
	Online      int    `json:"online"`
	Assigned    int    `json:"assigned"`
	Queued      int    `json:"queued"`
	ClosedToday int    `json:"closedToday"`
	Anomaly     int    `json:"anomaly"`
}

type monitorOverviewShop struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	ShopifyReady  bool     `json:"shopifyReady"`
	EmailReady    bool     `json:"emailReady"`
	AgentNames    []string `json:"agentNames"`
	Queued        int      `json:"queued"`
	Assigned      int      `json:"assigned"`
	ClosedToday   int      `json:"closedToday"`
	Anomaly       int      `json:"anomaly"`
	LastMessageAt string   `json:"lastMessageAt,omitempty"`
}

type monitorOverviewResponse struct {
	Totals       monitorOverviewTotals       `json:"totals"`
	AgentOptions []monitorAgentOption        `json:"agentOptions"`
	Agents       []monitorOverviewAgent      `json:"agents"`
	SkillGroups  []monitorOverviewSkillGroup `json:"skillGroups"`
	Shops        []monitorOverviewShop       `json:"shops"`
}

type cachedMonitorOverview struct {
	Response  monitorOverviewResponse
	ExpiresAt time.Time
}

func (s *Server) handleResponseMetrics(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionMonitorView)
	if !ok {
		return
	}
	query := r.URL.Query()
	shopID := strings.TrimSpace(query.Get("shopId"))
	agentID := strings.TrimSpace(query.Get("agentId"))
	status := strings.TrimSpace(query.Get("status"))
	channel := strings.ToLower(strings.TrimSpace(query.Get("channel")))
	skillGroup := strings.TrimSpace(query.Get("skillGroup"))
	if status != "" {
		normalized, err := normalizeConversationStatus(status)
		if err != nil {
			writeError(w, err)
			return
		}
		status = normalized
	}
	if channel != "" && channel != "chat" && channel != "email" {
		writeError(w, ErrInvalid)
		return
	}
	if !validMonitorSkillGroup(skillGroup) {
		writeError(w, ErrInvalid)
		return
	}
	conversations, err := s.listOperationalCustomerConversations(r.Context(), ConversationFilter{ShopID: shopID, Status: status})
	if err != nil {
		writeError(w, err)
		return
	}
	conversations, err = s.filterConversationsForModuleScope(r.Context(), user, DataScopeMonitor, conversations)
	if err != nil {
		writeError(w, err)
		return
	}
	sources, err := s.store.ListShopSources(r.Context(), "")
	if err != nil {
		writeError(w, err)
		return
	}
	sourceTypes := make(map[string]string, len(sources))
	for _, source := range sources {
		sourceTypes[source.ID] = monitorSourceType(source.Type)
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	eligibleAgents := make(map[string]bool, len(users))
	for _, item := range users {
		if !userIsCustomerServiceAgent(item) || item.Status != UserStatusActive || !userHasPermission(item, PermissionWorkbenchAccess) {
			continue
		}
		if agentID != "" && item.ID != agentID {
			continue
		}
		if skillGroup != "" && (item.Role != UserRoleAgent || item.SkillGroup != skillGroup) {
			continue
		}
		eligibleAgents[item.ID] = true
	}
	byAgent := map[string]*responseMetric{}
	conversationIDs := map[string]bool{}
	agentConversationIDs := map[string]map[string]bool{}
	firstCounts := map[string]int{}
	var total, firstTotal float64
	var totalCount, firstCount int
	for _, conversation := range conversations {
		if channel != "" && sourceTypes[conversation.SourceID] != channel {
			continue
		}
		conversationIDs[conversation.ID] = true
		if eligibleAgents[conversation.AssignedAgentID] {
			if byAgent[conversation.AssignedAgentID] == nil {
				byAgent[conversation.AssignedAgentID] = &responseMetric{UserID: conversation.AssignedAgentID}
			}
			if agentConversationIDs[conversation.AssignedAgentID] == nil {
				agentConversationIDs[conversation.AssignedAgentID] = map[string]bool{}
			}
			agentConversationIDs[conversation.AssignedAgentID][conversation.ID] = true
		}
	}
	samples, err := s.store.ListResponseSamples(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	scheduleVersions, err := s.monitorWorkScheduleVersions(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	todayStart, tomorrowStart := shanghaiDayBounds(time.Now().UTC())
	for _, sample := range samples {
		if !conversationIDs[sample.ConversationID] || !eligibleAgents[sample.AgentID] {
			continue
		}
		if sample.EndedAt.IsZero() || sample.EndedAt.Before(todayStart) || !sample.EndedAt.Before(tomorrowStart) {
			continue
		}
		metric := byAgent[sample.AgentID]
		if metric == nil {
			metric = &responseMetric{UserID: sample.AgentID}
			byAgent[sample.AgentID] = metric
		}
		if agentConversationIDs[sample.AgentID] == nil {
			agentConversationIDs[sample.AgentID] = map[string]bool{}
		}
		agentConversationIDs[sample.AgentID][sample.ConversationID] = true
		seconds := sample.Seconds
		if !sample.StartedAt.IsZero() && !sample.EndedAt.IsZero() {
			seconds = monitorBusinessDuration(sample.StartedAt, sample.EndedAt, scheduleVersions).Seconds()
		}
		metric.ResponseCount++
		metric.AverageResponseSec += seconds
		total += seconds
		totalCount++
		if sample.First {
			metric.FirstResponseSec += seconds
			firstCounts[metric.UserID]++
			firstTotal += seconds
			firstCount++
		}
	}
	metrics := make([]responseMetric, 0, len(byAgent))
	for _, metric := range byAgent {
		metric.ConversationCount = len(agentConversationIDs[metric.UserID])
		if metric.ResponseCount > 0 {
			metric.AverageResponseSec /= float64(metric.ResponseCount)
		}
		if firstCounts[metric.UserID] > 0 {
			metric.FirstResponseSec /= float64(firstCounts[metric.UserID])
		}
		metrics = append(metrics, *metric)
	}
	sort.Slice(metrics, func(i, j int) bool { return metrics[i].AverageResponseSec < metrics[j].AverageResponseSec })
	response := responseMetricsResponse{Metrics: metrics}
	if totalCount > 0 {
		response.AverageResponseSec = total / float64(totalCount)
	}
	if firstCount > 0 {
		response.FirstResponseSec = firstTotal / float64(firstCount)
	}
	writeJSONResponse(w, http.StatusOK, response)
}

func (s *Server) handleMonitorOverview(w http.ResponseWriter, r *http.Request) {
	currentUser, ok := s.requirePermission(w, r, PermissionMonitorView)
	if !ok {
		return
	}
	query := r.URL.Query()
	cacheKey := ""
	useCache := effectiveModuleScope(currentUser, DataScopeMonitor) == AccessScopeAll
	if useCache {
		cacheKey = query.Encode()
		s.monitorCacheMu.Lock()
		cached, cachedOK := s.monitorCache[cacheKey]
		s.monitorCacheMu.Unlock()
		if cachedOK && time.Now().Before(cached.ExpiresAt) {
			writeJSONResponse(w, http.StatusOK, cached.Response)
			return
		}
	}
	shopID := strings.TrimSpace(query.Get("shopId"))
	agentID := strings.TrimSpace(query.Get("agentId"))
	status := strings.TrimSpace(query.Get("status"))
	channel := strings.ToLower(strings.TrimSpace(query.Get("channel")))
	skillGroup := strings.TrimSpace(query.Get("skillGroup"))
	if status != "" {
		normalized, err := normalizeConversationStatus(status)
		if err != nil {
			writeError(w, err)
			return
		}
		status = normalized
	}
	if channel != "" && channel != "chat" && channel != "email" {
		writeError(w, ErrInvalid)
		return
	}
	if !validMonitorSkillGroup(skillGroup) {
		writeError(w, ErrInvalid)
		return
	}

	shops, err := s.store.ListShops(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	shops = filterActiveShops(shops)
	if effectiveModuleScope(currentUser, DataScopeMonitor) == AccessScopeAssigned {
		allowed, listErr := s.store.ListUserShopIDs(r.Context(), currentUser.ID)
		if listErr != nil {
			writeError(w, listErr)
			return
		}
		shops = filterShopsByIDs(shops, allowed)
	}
	if shopID != "" {
		filteredShops := make([]Shop, 0, 1)
		for _, shop := range shops {
			if shop.ID == shopID {
				filteredShops = append(filteredShops, shop)
			}
		}
		if len(filteredShops) == 0 {
			writeError(w, ErrNotFound)
			return
		}
		shops = filteredShops
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	userByID := make(map[string]User, len(users))
	serviceAccounts := make([]User, 0)
	for _, user := range users {
		userByID[user.ID] = user
		if userIsCustomerServiceAgent(user) && user.Status == UserStatusActive && userHasPermission(user, PermissionWorkbenchAccess) {
			serviceAccounts = append(serviceAccounts, user)
		}
	}

	accessibleShopSet := map[string]bool{}
	for _, shop := range shops {
		accessibleShopSet[shop.ID] = true
	}

	assignments, err := s.store.ListShopAssignments(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	agentShopIDs := map[string][]string{}
	agentShopSets := map[string]map[string]bool{}
	for _, assignment := range assignments {
		agent, found := userByID[assignment.UserID]
		if !found || !userIsCustomerServiceAgent(agent) || agent.Status != UserStatusActive || !userHasPermission(agent, PermissionWorkbenchAccess) || !accessibleShopSet[assignment.ShopID] {
			continue
		}
		agentShopIDs[agent.ID] = append(agentShopIDs[agent.ID], assignment.ShopID)
		if agentShopSets[agent.ID] == nil {
			agentShopSets[agent.ID] = map[string]bool{}
		}
		agentShopSets[agent.ID][assignment.ShopID] = true
	}
	for _, agent := range serviceAccounts {
		if agentShopSets[agent.ID] == nil {
			agentShopSets[agent.ID] = map[string]bool{}
		}
	}

	filteredAccounts := make([]User, 0, len(serviceAccounts))
	for _, agent := range serviceAccounts {
		if shopID != "" && !agentShopSets[agent.ID][shopID] {
			continue
		}
		if shopID == "" && effectiveModuleScope(currentUser, DataScopeMonitor) == AccessScopeAssigned && len(agentShopIDs[agent.ID]) == 0 && agent.ID != currentUser.ID {
			continue
		}
		if skillGroup != "" && (agent.Role != UserRoleAgent || agent.SkillGroup != skillGroup) {
			continue
		}
		filteredAccounts = append(filteredAccounts, agent)
	}
	agentOptions := make([]monitorAgentOption, 0, len(filteredAccounts))
	for _, agent := range filteredAccounts {
		agentOptions = append(agentOptions, monitorAgentOption{
			ID: agent.ID, Name: defaultString(strings.TrimSpace(agent.DisplayName), agent.Email),
			Role: agent.Role, SkillGroup: agent.SkillGroup,
		})
	}
	sort.Slice(agentOptions, func(i, j int) bool { return agentOptions[i].Name < agentOptions[j].Name })
	if agentID != "" {
		found := false
		for _, option := range agentOptions {
			if option.ID == agentID {
				found = true
				break
			}
		}
		if !found {
			writeError(w, ErrInvalid)
			return
		}
	}
	agents := make([]User, 0, len(filteredAccounts))
	for _, agent := range filteredAccounts {
		if agentID == "" || agent.ID == agentID {
			agents = append(agents, agent)
		}
	}

	if shopID == "" && (agentID != "" || skillGroup != "") {
		filteredShops := make([]Shop, 0, len(shops))
		for _, shop := range shops {
			for _, agent := range agents {
				if agentShopSets[agent.ID][shop.ID] {
					filteredShops = append(filteredShops, shop)
					break
				}
			}
		}
		shops = filteredShops
	}

	activeShopSet := map[string]bool{}
	for _, shop := range shops {
		activeShopSet[shop.ID] = true
	}
	allSources, err := s.store.ListShopSources(r.Context(), "")
	if err != nil {
		writeError(w, err)
		return
	}
	sourceByID := make(map[string]ShopSource, len(allSources))
	sourcesByShopID := map[string][]ShopSource{}
	activeChannels := 0
	for _, source := range allSources {
		if !activeShopSet[source.ShopID] {
			continue
		}
		sourceByID[source.ID] = source
		sourcesByShopID[source.ShopID] = append(sourcesByShopID[source.ShopID], source)
		if isConnectedChannelSource(source) && (channel == "" || monitorSourceType(source.Type) == channel) {
			activeChannels++
		}
	}

	shopAgentNames := map[string][]string{}
	for _, agent := range agents {
		for _, assignedShopID := range agentShopIDs[agent.ID] {
			if activeShopSet[assignedShopID] {
				shopAgentNames[assignedShopID] = append(shopAgentNames[assignedShopID], defaultString(strings.TrimSpace(agent.DisplayName), agent.Email))
			}
		}
	}

	conversations, err := s.listOperationalCustomerConversations(r.Context(), ConversationFilter{
		ShopID: shopID,
		Status: status,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	conversations, err = s.filterConversationsForModuleScope(r.Context(), currentUser, DataScopeMonitor, conversations)
	if err != nil {
		writeError(w, err)
		return
	}
	now := time.Now().UTC()
	scheduleVersions, err := s.monitorWorkScheduleVersions(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	todayStart, tomorrowStart := shanghaiDayBounds(now)
	selectedAgentSet := make(map[string]bool, len(agents))
	for _, agent := range agents {
		selectedAgentSet[agent.ID] = true
	}
	hasEligibleAgentForShop := func(targetShopID string) bool {
		for _, agent := range agents {
			if agentShopSets[agent.ID][targetShopID] {
				return true
			}
		}
		return false
	}
	filtered := make([]Conversation, 0, len(conversations))
	for _, conversation := range conversations {
		if !activeShopSet[conversation.ShopID] {
			continue
		}
		sourceType := monitorSourceType(sourceByID[conversation.SourceID].Type)
		if channel != "" && channel != sourceType {
			continue
		}
		if agentID != "" || skillGroup != "" {
			if conversation.AssignedAgentID != "" {
				if !selectedAgentSet[conversation.AssignedAgentID] {
					continue
				}
			} else if conversation.Status != ConversationStatusOpen || !hasEligibleAgentForShop(conversation.ShopID) {
				continue
			}
		}
		filtered = append(filtered, conversation)
	}
	conversationsByAgent := make(map[string][]Conversation, len(agents))
	conversationsByShop := make(map[string][]Conversation, len(shops))
	queuedByShop := make(map[string]int, len(shops))
	for _, conversation := range filtered {
		conversationsByShop[conversation.ShopID] = append(conversationsByShop[conversation.ShopID], conversation)
		if conversation.AssignedAgentID != "" {
			conversationsByAgent[conversation.AssignedAgentID] = append(conversationsByAgent[conversation.AssignedAgentID], conversation)
		} else if conversation.Status == ConversationStatusOpen {
			queuedByShop[conversation.ShopID]++
		}
	}

	totals := monitorOverviewTotals{
		Shops:          len(shops),
		ActiveChannels: activeChannels,
	}
	totals.Agents = len(agents)
	anomalyByConversationID := make(map[string]bool, len(filtered))
	for _, conversation := range filtered {
		anomalyByConversationID[conversation.ID] = conversation.Status != ConversationStatusClosed &&
			!conversation.LastMessageAt.IsZero() &&
			monitorBusinessDuration(conversation.LastMessageAt, now, scheduleVersions) > 30*time.Minute
	}
	isAnomaly := func(conversation Conversation) bool { return anomalyByConversationID[conversation.ID] }
	isClosedToday := func(conversation Conversation) bool {
		closedAt := conversation.ClosedAt
		if closedAt.IsZero() {
			closedAt = conversation.UpdatedAt
		}
		return conversation.Status == ConversationStatusClosed &&
			!closedAt.Before(todayStart) &&
			closedAt.Before(tomorrowStart)
	}
	for _, conversation := range filtered {
		switch conversation.Status {
		case ConversationStatusOpen:
			totals.Queued++
		case ConversationStatusAssigned:
			totals.Assigned++
		}
		if sourceByID[conversation.SourceID].Type == SourceTypeEmail && conversation.Status != ConversationStatusClosed {
			totals.EmailPending++
		}
		if isClosedToday(conversation) {
			totals.ClosedToday++
		}
		if isAnomaly(conversation) {
			totals.Anomaly++
		}
	}

	connected := s.connectedUserIDs()
	agentRows := make([]monitorOverviewAgent, 0, len(agents))
	for _, agent := range agents {
		if agentID != "" && agent.ID != agentID {
			continue
		}
		shopNames := make([]string, 0, len(agentShopIDs[agent.ID]))
		for _, assignedShopID := range agentShopIDs[agent.ID] {
			if shopID != "" && assignedShopID != shopID {
				continue
			}
			for _, shop := range shops {
				if shop.ID == assignedShopID {
					shopNames = append(shopNames, defaultString(shop.DisplayName, shop.ID))
					break
				}
			}
		}
		row := monitorOverviewAgent{
			ID:             agent.ID,
			Name:           defaultString(strings.TrimSpace(agent.DisplayName), agent.Email),
			Role:           agent.Role,
			SkillGroup:     agent.SkillGroup,
			Online:         agent.ReceptionOnline && connected[agent.ID],
			ShopNames:      shopNames,
			ReceptionLimit: normalizeReceptionLimit(agent.ReceptionLimit),
		}
		for _, conversation := range conversationsByAgent[agent.ID] {
			if conversation.Status == ConversationStatusAssigned {
				row.Assigned++
			}
			if isClosedToday(conversation) {
				row.ClosedToday++
			}
			if isAnomaly(conversation) {
				row.Anomaly++
			}
		}
		for assignedShopID := range agentShopSets[agent.ID] {
			row.Queued += queuedByShop[assignedShopID]
		}
		if row.ReceptionLimit > 0 {
			row.ReceptionPercent = row.Assigned * 100 / row.ReceptionLimit
		}
		agentRows = append(agentRows, row)
	}
	sort.Slice(agentRows, func(i, j int) bool { return agentRows[i].Name < agentRows[j].Name })

	skillGroupRows := make([]monitorOverviewSkillGroup, 0, 2)
	for _, groupName := range []string{SkillGroupConsulting, SkillGroupAfterSales} {
		if skillGroup != "" && skillGroup != groupName {
			continue
		}
		row := monitorOverviewSkillGroup{Name: groupName}
		groupAgents := map[string]bool{}
		for _, agent := range agents {
			if agent.Role != UserRoleAgent || agent.SkillGroup != groupName {
				continue
			}
			groupAgents[agent.ID] = true
			row.Agents++
			if connected[agent.ID] {
				row.Online++
			}
		}
		groupShopSet := map[string]bool{}
		for groupAgentID := range groupAgents {
			for assignedShopID := range agentShopSets[groupAgentID] {
				groupShopSet[assignedShopID] = true
			}
		}
		for groupAgentID := range groupAgents {
			for _, conversation := range conversationsByAgent[groupAgentID] {
				if conversation.Status == ConversationStatusAssigned {
					row.Assigned++
				}
				if isClosedToday(conversation) {
					row.ClosedToday++
				}
				if isAnomaly(conversation) {
					row.Anomaly++
				}
			}
		}
		for groupShopID := range groupShopSet {
			row.Queued += queuedByShop[groupShopID]
		}
		skillGroupRows = append(skillGroupRows, row)
	}

	shopRows := make([]monitorOverviewShop, 0, len(shops))
	for _, shop := range shops {
		row := monitorOverviewShop{
			ID:         shop.ID,
			Name:       defaultString(shop.DisplayName, shop.ID),
			AgentNames: append([]string(nil), shopAgentNames[shop.ID]...),
		}
		for _, source := range sourcesByShopID[shop.ID] {
			if !isConnectedChannelSource(source) {
				continue
			}
			if source.Type == SourceTypeEmail {
				row.EmailReady = true
			}
			if source.Type == SourceTypeShopifyAPI || source.Type == SourceTypeShopifyChat {
				row.ShopifyReady = true
			}
		}
		var lastMessageAt time.Time
		for _, conversation := range conversationsByShop[shop.ID] {
			switch conversation.Status {
			case ConversationStatusOpen:
				row.Queued++
			case ConversationStatusAssigned:
				row.Assigned++
			}
			if isClosedToday(conversation) {
				row.ClosedToday++
			}
			if isAnomaly(conversation) {
				row.Anomaly++
			}
			if conversation.LastMessageAt.After(lastMessageAt) {
				lastMessageAt = conversation.LastMessageAt
			}
		}
		if !lastMessageAt.IsZero() {
			row.LastMessageAt = lastMessageAt.UTC().Format(time.RFC3339)
		}
		sort.Strings(row.AgentNames)
		shopRows = append(shopRows, row)
	}
	sort.Slice(shopRows, func(i, j int) bool { return shopRows[i].Name < shopRows[j].Name })

	response := monitorOverviewResponse{
		Totals:       totals,
		AgentOptions: nonNilSlice(agentOptions),
		Agents:       nonNilSlice(agentRows),
		SkillGroups:  nonNilSlice(skillGroupRows),
		Shops:        nonNilSlice(shopRows),
	}
	if useCache {
		s.monitorCacheMu.Lock()
		for key, item := range s.monitorCache {
			if time.Now().After(item.ExpiresAt) {
				delete(s.monitorCache, key)
			}
		}
		s.monitorCache[cacheKey] = cachedMonitorOverview{Response: response, ExpiresAt: time.Now().Add(30 * time.Second)}
		s.monitorCacheMu.Unlock()
	}
	writeJSONResponse(w, http.StatusOK, response)
}

type monitorConversationItem struct {
	Conversation
	ShopName   string `json:"shopName"`
	AgentName  string `json:"agentName,omitempty"`
	SourceType string `json:"sourceType"`
}

type monitorConversationSummary struct {
	Open     int `json:"open"`
	Assigned int `json:"assigned"`
	Closed   int `json:"closed"`
	Anomaly  int `json:"anomaly"`
}

type monitorConversationPage struct {
	Items    []monitorConversationItem  `json:"items"`
	Total    int                        `json:"total"`
	Page     int                        `json:"page"`
	PageSize int                        `json:"pageSize"`
	Summary  monitorConversationSummary `json:"summary"`
}

func (s *Server) handleMonitorConversations(w http.ResponseWriter, r *http.Request) {
	currentUser, ok := s.requirePermission(w, r, PermissionMonitorView)
	if !ok {
		return
	}
	shopID := strings.TrimSpace(r.URL.Query().Get("shopId"))
	agentID := strings.TrimSpace(r.URL.Query().Get("agentId"))
	if shopID == "" && agentID == "" {
		writeError(w, ErrInvalid)
		return
	}
	if shopID != "" {
		if !s.requireModuleShopAccess(w, r, currentUser, DataScopeMonitor, shopID) {
			return
		}
	}
	if agentID != "" {
		user, err := s.store.GetUser(r.Context(), agentID)
		if err != nil {
			writeError(w, err)
			return
		}
		if !userIsCustomerServiceAgent(user) {
			writeError(w, ErrInvalid)
			return
		}
	}

	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" {
		normalized, err := normalizeConversationStatus(status)
		if err != nil {
			writeError(w, err)
			return
		}
		status = normalized
	}
	channel := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("channel")))
	if channel != "" && channel != "chat" && channel != "email" {
		writeError(w, ErrInvalid)
		return
	}
	search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
	anomalyOnly := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("anomaly")), "true")
	page := positiveQueryInt(r.URL.Query().Get("page"), 1)
	pageSize := positiveQueryInt(r.URL.Query().Get("pageSize"), 30)
	if pageSize > 100 {
		pageSize = 100
	}

	conversations, err := s.listOperationalCustomerConversations(r.Context(), ConversationFilter{
		ShopID:          shopID,
		Status:          status,
		AssignedAgentID: agentID,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	conversations, err = s.filterConversationsForModuleScope(r.Context(), currentUser, DataScopeMonitor, conversations)
	if err != nil {
		writeError(w, err)
		return
	}

	shops, err := s.store.ListShops(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	shopNames := make(map[string]string, len(shops))
	for _, shop := range shops {
		shopNames[shop.ID] = shop.DisplayName
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	agentNames := make(map[string]string, len(users))
	for _, user := range users {
		agentNames[user.ID] = defaultString(strings.TrimSpace(user.DisplayName), user.Email)
	}

	allSources, err := s.store.ListShopSources(r.Context(), "")
	if err != nil {
		writeError(w, err)
		return
	}
	sourceTypes := make(map[string]string, len(allSources))
	for _, source := range allSources {
		sourceTypes[source.ID] = monitorSourceType(source.Type)
	}

	now := time.Now().UTC()
	scheduleVersions, err := s.monitorWorkScheduleVersions(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	filtered := make([]monitorConversationItem, 0, len(conversations))
	summary := monitorConversationSummary{}
	for _, conversation := range conversations {
		sourceType := sourceTypes[conversation.SourceID]
		if channel != "" && sourceType != channel {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(strings.Join([]string{
			conversation.CustomerName,
			conversation.CustomerEmail,
			conversation.Subject,
		}, " ")), search) {
			continue
		}
		anomaly := conversation.Status != ConversationStatusClosed &&
			!conversation.LastMessageAt.IsZero() &&
			monitorBusinessDuration(conversation.LastMessageAt, now, scheduleVersions) > 30*time.Minute
		if anomalyOnly && !anomaly {
			continue
		}
		switch conversation.Status {
		case ConversationStatusOpen:
			summary.Open++
		case ConversationStatusAssigned:
			summary.Assigned++
		case ConversationStatusClosed:
			summary.Closed++
		}
		if anomaly {
			summary.Anomaly++
		}
		filtered = append(filtered, monitorConversationItem{
			Conversation: conversation,
			ShopName:     defaultString(shopNames[conversation.ShopID], conversation.ShopID),
			AgentName:    agentNames[conversation.AssignedAgentID],
			SourceType:   sourceType,
		})
	}

	total := len(filtered)
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	writeJSONResponse(w, http.StatusOK, monitorConversationPage{
		Items:    nonNilSlice(filtered[start:end]),
		Total:    total,
		Page:     page,
		PageSize: pageSize,
		Summary:  summary,
	})
}

func (s *Server) handleMonitorConversationSubroutes(w http.ResponseWriter, r *http.Request) {
	currentUser, ok := s.requirePermission(w, r, PermissionMonitorView)
	if !ok {
		return
	}
	parts := splitPath(r.URL.Path)
	if len(parts) != 6 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "monitor" || parts[3] != "conversations" || parts[5] != "messages" {
		http.NotFound(w, r)
		return
	}
	conversation, err := s.store.GetConversation(r.Context(), parts[4])
	if err != nil {
		writeError(w, err)
		return
	}
	if !s.requireModuleConversationAccess(w, r, currentUser, DataScopeMonitor, conversation) {
		return
	}
	pageSize := positiveQueryInt(r.URL.Query().Get("pageSize"), 100)
	if pageSize > 200 {
		pageSize = 200
	}
	messages, err := s.store.ListMessagePage(r.Context(), conversation.ID, strings.TrimSpace(r.URL.Query().Get("before")), pageSize)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(expandQuotedEmailMessagesForDisplay(messages, conversation.Subject)))
}

func positiveQueryInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}

func monitorSourceType(sourceType string) string {
	if sourceType == SourceTypeEmail {
		return "email"
	}
	return "chat"
}

func validMonitorSkillGroup(value string) bool {
	switch strings.TrimSpace(value) {
	case "", SkillGroupConsulting, SkillGroupAfterSales:
		return true
	default:
		return false
	}
}

func shanghaiDayBounds(now time.Time) (time.Time, time.Time) {
	localNow := now.In(shanghaiLocation())
	start := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, localNow.Location())
	return start, start.AddDate(0, 0, 1)
}
