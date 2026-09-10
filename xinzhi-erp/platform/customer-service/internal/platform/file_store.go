package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type FileStore struct {
	*MemoryStore
	path            string
	snapshotBackend tenantSnapshotBackend
	mutationMu      sync.Mutex
	revision        int64
}

type tenantSnapshotBackend interface {
	Load(context.Context) ([]byte, int64, error)
	Save(context.Context, []byte, int64) (int64, error)
	Health(context.Context) HealthStatus
}

type fileStoreSnapshot struct {
	Next                  int64                               `json:"next"`
	ERPTenantID           string                              `json:"erpTenantId,omitempty"`
	Shops                 map[string]Shop                     `json:"shops"`
	Users                 map[string]fileUser                 `json:"users"`
	Sessions              map[string]fileSession              `json:"sessions"`
	ShopAgents            map[string]ShopAgent                `json:"shopAgents"`
	Sources               map[string]ShopSource               `json:"sources"`
	VisitorSchemes        map[string]VisitorScheme            `json:"visitorSchemes,omitempty"`
	VisitorSchemeShops    map[string]string                   `json:"visitorSchemeShops,omitempty"`
	Installations         map[string]fileShopifyInstallation  `json:"installations"`
	ShopifyAppProfiles    map[string]fileShopifyAppProfile    `json:"shopifyAppProfiles"`
	EmailInstalls         map[string]fileEmailInstallation    `json:"emailInstallations"`
	EmailHistoryImports   map[string]EmailHistoryImportJob    `json:"emailHistoryImports,omitempty"`
	Conversations         map[string]Conversation             `json:"conversations"`
	Messages              map[string][]Message                `json:"messages"`
	ConversationEmailTags map[string][]EmailProcessingTag     `json:"conversationEmailTags,omitempty"`
	ConversationReads     map[string]time.Time                `json:"conversationReads"`
	Knowledge             map[string]KnowledgeEntry           `json:"knowledge"`
	AISettings            *fileAISettings                     `json:"aiSettings,omitempty"`
	LogisticsSettings     *fileLogisticsSettings              `json:"logisticsSettings,omitempty"`
	CuiqiuDomainSettings  map[string]fileCuiqiuDomainSettings `json:"cuiqiuDomainSettings,omitempty"`
	MonitorWorkSchedules  []MonitorWorkSchedule               `json:"monitorWorkSchedules,omitempty"`
	SLASettings           *SLASettings                        `json:"slaSettings,omitempty"`
	RecordCategories      []RecordCategoryOption              `json:"recordCategories,omitempty"`
	TransferRequests      map[string]TransferRequest          `json:"transferRequests,omitempty"`
	Tickets               map[string]Ticket                   `json:"tickets,omitempty"`
	TicketComments        map[string][]TicketComment          `json:"ticketComments,omitempty"`
	AccountAuditLogs      []AccountAuditLog                   `json:"accountAuditLogs,omitempty"`
	PrivacyRedactions     map[string]PrivacyRedactionReceipt  `json:"shopifyPrivacyRedactions,omitempty"`
}

type fileUser struct {
	User
	PasswordHash     string `json:"passwordHash"`
	IdentityRevision int64  `json:"identityRevision,omitempty"`
}

type fileSession struct {
	Session
	TokenHash string `json:"tokenHash"`
}

type fileShopifyInstallation struct {
	ShopifyInstallation
	AccessToken string `json:"accessToken"`
}

type fileShopifyAppProfile struct {
	ShopifyAppProfile
	EncryptedClientSecret    string `json:"encryptedClientSecret"`
	EncryptedAutomationToken string `json:"encryptedAutomationToken"`
}

type fileEmailInstallation struct {
	EmailInstallation
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}

type fileAISettings struct {
	AISettings
	EncryptedKey string `json:"encryptedKey"`
}

type fileLogisticsSettings struct {
	LogisticsSettings
	EncryptedKey string `json:"encryptedKey"`
}

type fileCuiqiuDomainSettings struct {
	CuiqiuDomainSettings
	EncryptedToken string `json:"encryptedToken"`
}

func OpenFileStore(path string) (*FileStore, error) {
	store := &FileStore{
		MemoryStore: NewMemoryStore(),
		path:        filepath.Clean(path),
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func openTenantSnapshotStore(backend tenantSnapshotBackend) (*FileStore, error) {
	if backend == nil {
		return nil, ErrInvalid
	}
	store := &FileStore{
		MemoryStore:     NewMemoryStore(),
		snapshotBackend: backend,
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *FileStore) Health(ctx context.Context) HealthStatus {
	if s.snapshotBackend != nil {
		return s.snapshotBackend.Health(ctx)
	}
	if err := ctx.Err(); err != nil {
		return HealthStatus{Name: "file", OK: false, Error: err.Error()}
	}
	if s.path == "" {
		return HealthStatus{Name: "file", OK: false, Error: "data file path is empty"}
	}
	return HealthStatus{Name: "file", OK: true}
}

func (s *FileStore) load() error {
	var data []byte
	var revision int64
	var err error
	if s.snapshotBackend != nil {
		data, revision, err = s.snapshotBackend.Load(context.Background())
	} else {
		if s.path == "" {
			return ErrInvalid
		}
		data, err = os.ReadFile(s.path)
		if os.IsNotExist(err) {
			return nil
		}
	}
	if err != nil {
		return err
	}
	if len(data) == 0 {
		s.revision = revision
		return nil
	}
	var snapshot fileStoreSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return err
	}
	s.revision = revision
	s.applySnapshot(snapshot)
	return nil
}

func (s *FileStore) applySnapshot(snapshot fileStoreSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.next = snapshot.Next
	s.erpTenantID = snapshot.ERPTenantID
	if snapshot.Shops != nil {
		s.shops = snapshot.Shops
	}
	if snapshot.Users != nil {
		s.users = usersFromSnapshot(snapshot.Users)
		for id, user := range s.users {
			user.ReceptionLimit = normalizeReceptionLimit(user.ReceptionLimit)
			s.users[id] = user
		}
	}
	if snapshot.Sessions != nil {
		s.sessions = sessionsFromSnapshot(snapshot.Sessions)
	}
	if snapshot.ShopAgents != nil {
		s.shopAgents = snapshot.ShopAgents
	}
	if snapshot.Sources != nil {
		s.sources = snapshot.Sources
	}
	if snapshot.VisitorSchemes != nil {
		s.visitorSchemes = snapshot.VisitorSchemes
	}
	if _, ok := s.visitorSchemes[defaultVisitorSchemeID]; !ok {
		s.visitorSchemes[defaultVisitorSchemeID] = defaultVisitorScheme()
	}
	if snapshot.VisitorSchemeShops != nil {
		s.visitorSchemeShops = snapshot.VisitorSchemeShops
	} else {
		for sourceID, source := range s.sources {
			if source.Type != SourceTypeShopifyChat {
				continue
			}
			source = withShopifyChatDefaults(source)
			s.sources[sourceID] = source
			s.visitorSchemeShops[source.ShopID] = defaultVisitorSchemeID
		}
	}
	if snapshot.Installations != nil {
		s.installations = shopifyInstallationsFromSnapshot(snapshot.Installations)
	}
	if snapshot.ShopifyAppProfiles != nil {
		s.shopifyAppProfiles = shopifyAppProfilesFromSnapshot(snapshot.ShopifyAppProfiles)
	}
	if snapshot.EmailInstalls != nil {
		s.emailInstalls = emailInstallationsFromSnapshot(snapshot.EmailInstalls)
	}
	if snapshot.EmailHistoryImports != nil {
		s.emailHistoryImports = snapshot.EmailHistoryImports
	}
	if snapshot.Conversations != nil {
		s.conversations = snapshot.Conversations
		for id, conversation := range s.conversations {
			conversation.Kind = normalizeConversationKind(conversation.Kind)
			if conversation.Kind == ConversationKindCustomer {
				conversation.ReplyAllowed = true
			}
			s.conversations[id] = conversation
		}
	}
	if snapshot.Messages != nil {
		s.messages = snapshot.Messages
	}
	if snapshot.ConversationEmailTags != nil {
		s.conversationEmailTags = cloneSliceMap(snapshot.ConversationEmailTags)
	}
	if snapshot.ConversationReads != nil {
		s.conversationReads = snapshot.ConversationReads
	}
	if snapshot.Knowledge != nil {
		s.knowledge = snapshot.Knowledge
	}
	if snapshot.AISettings != nil {
		s.aiSettings = snapshot.AISettings.AISettings
		s.aiSettings.Models = append([]string(nil), snapshot.AISettings.Models...)
		s.aiSettings.EncryptedKey = snapshot.AISettings.EncryptedKey
		s.hasAISettings = true
	}
	if snapshot.LogisticsSettings != nil {
		s.logisticsSettings = snapshot.LogisticsSettings.LogisticsSettings
		s.logisticsSettings.EncryptedKey = snapshot.LogisticsSettings.EncryptedKey
		s.hasLogisticsSettings = true
	}
	if snapshot.CuiqiuDomainSettings != nil {
		s.cuiqiuDomainSettings = make(map[string]CuiqiuDomainSettings, len(snapshot.CuiqiuDomainSettings))
		for domain, stored := range snapshot.CuiqiuDomainSettings {
			settings := stored.CuiqiuDomainSettings
			settings.EncryptedToken = stored.EncryptedToken
			s.cuiqiuDomainSettings[domain] = settings
		}
	}
	if snapshot.MonitorWorkSchedules != nil {
		s.monitorWorkSchedules = cloneMonitorWorkSchedules(snapshot.MonitorWorkSchedules)
	}
	if snapshot.SLASettings != nil {
		s.slaSettings = *snapshot.SLASettings
		s.hasSLASettings = true
	}
	if len(snapshot.RecordCategories) > 0 {
		s.recordCategories = cloneRecordCategories(snapshot.RecordCategories)
	}
	if snapshot.TransferRequests != nil {
		s.transferRequests = snapshot.TransferRequests
	}
	if snapshot.Tickets != nil {
		s.tickets = snapshot.Tickets
	}
	if snapshot.TicketComments != nil {
		s.ticketComments = snapshot.TicketComments
	}
	if snapshot.AccountAuditLogs != nil {
		s.accountAuditLogs = append([]AccountAuditLog(nil), snapshot.AccountAuditLogs...)
	}
	if snapshot.PrivacyRedactions != nil {
		s.privacyRedactions = cloneShopifyPrivacyRedactionReceipts(snapshot.PrivacyRedactions)
	}
}

func (s *FileStore) snapshot() fileStoreSnapshot {
	s.mu.RLock()
	snapshot := fileStoreSnapshot{
		Next:                  s.next,
		ERPTenantID:           s.erpTenantID,
		Shops:                 cloneMap(s.shops),
		Users:                 usersToSnapshot(s.users),
		Sessions:              sessionsToSnapshot(s.sessions),
		ShopAgents:            cloneMap(s.shopAgents),
		Sources:               cloneMap(s.sources),
		VisitorSchemes:        cloneVisitorSchemeMap(s.visitorSchemes),
		VisitorSchemeShops:    cloneMap(s.visitorSchemeShops),
		Installations:         shopifyInstallationsToSnapshot(s.installations),
		ShopifyAppProfiles:    shopifyAppProfilesToSnapshot(s.shopifyAppProfiles),
		EmailInstalls:         emailInstallationsToSnapshot(s.emailInstalls),
		EmailHistoryImports:   cloneMap(s.emailHistoryImports),
		Conversations:         cloneMap(s.conversations),
		Messages:              cloneSliceMap(s.messages),
		ConversationEmailTags: cloneSliceMap(s.conversationEmailTags),
		ConversationReads:     cloneMap(s.conversationReads),
		Knowledge:             cloneKnowledgeMap(s.knowledge),
		RecordCategories:      cloneRecordCategories(s.recordCategories),
		TransferRequests:      cloneMap(s.transferRequests),
		Tickets:               cloneTickets(s.tickets),
		TicketComments:        cloneSliceMap(s.ticketComments),
		MonitorWorkSchedules:  cloneMonitorWorkSchedules(s.monitorWorkSchedules),
		CuiqiuDomainSettings:  cuiqiuDomainSettingsToSnapshot(s.cuiqiuDomainSettings),
		AccountAuditLogs:      append([]AccountAuditLog(nil), s.accountAuditLogs...),
		PrivacyRedactions:     cloneShopifyPrivacyRedactionReceipts(s.privacyRedactions),
	}
	if s.hasAISettings {
		settings := s.aiSettings
		settings.Models = append([]string(nil), settings.Models...)
		snapshot.AISettings = &fileAISettings{AISettings: settings, EncryptedKey: settings.EncryptedKey}
	}
	if s.hasLogisticsSettings {
		settings := s.logisticsSettings
		snapshot.LogisticsSettings = &fileLogisticsSettings{LogisticsSettings: settings, EncryptedKey: settings.EncryptedKey}
	}
	if s.hasSLASettings {
		settings := s.slaSettings
		snapshot.SLASettings = &settings
	}
	s.mu.RUnlock()
	return snapshot
}

func marshalFileStoreSnapshot(snapshot fileStoreSnapshot) ([]byte, error) {
	return json.MarshalIndent(snapshot, "", "  ")
}

func (s *FileStore) persistSnapshot(
	ctx context.Context,
	snapshot fileStoreSnapshot,
	expectedRevision int64,
) (int64, error) {
	data, err := marshalFileStoreSnapshot(snapshot)
	if err != nil {
		return expectedRevision, err
	}
	if s.snapshotBackend != nil {
		return s.snapshotBackend.Save(ctx, data, expectedRevision)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0755); err != nil {
		return expectedRevision, err
	}
	tmpFile, err := os.CreateTemp(filepath.Dir(s.path), filepath.Base(s.path)+".*.tmp")
	if err != nil {
		return expectedRevision, err
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)
	if err := tmpFile.Chmod(0600); err != nil {
		_ = tmpFile.Close()
		return expectedRevision, err
	}
	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return expectedRevision, err
	}
	if err := tmpFile.Close(); err != nil {
		return expectedRevision, err
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		return expectedRevision, err
	}
	return expectedRevision + 1, nil
}

func mutateFileStore[T any](
	ctx context.Context,
	store *FileStore,
	mutate func(*MemoryStore) (T, error),
) (T, error) {
	store.mutationMu.Lock()
	defer store.mutationMu.Unlock()

	candidate := NewMemoryStore()
	candidateFile := &FileStore{MemoryStore: candidate}
	candidateFile.applySnapshot(store.snapshot())
	result, err := mutate(candidate)
	if err != nil {
		return result, err
	}
	nextSnapshot := candidateFile.snapshot()
	nextRevision, err := store.persistSnapshot(ctx, nextSnapshot, store.revision)
	if err != nil {
		return result, err
	}
	store.applySnapshot(nextSnapshot)
	store.revision = nextRevision
	return result, nil
}

func mutateFileStoreError(
	ctx context.Context,
	store *FileStore,
	mutate func(*MemoryStore) error,
) error {
	_, err := mutateFileStore(ctx, store, func(candidate *MemoryStore) (struct{}, error) {
		return struct{}{}, mutate(candidate)
	})
	return err
}

func cloneKnowledgeMap(input map[string]KnowledgeEntry) map[string]KnowledgeEntry {
	out := make(map[string]KnowledgeEntry, len(input))
	for key, entry := range input {
		entry.Tags = append([]string(nil), entry.Tags...)
		out[key] = entry
	}
	return out
}

func cloneVisitorSchemeMap(input map[string]VisitorScheme) map[string]VisitorScheme {
	out := make(map[string]VisitorScheme, len(input))
	for key, scheme := range input {
		out[key] = cloneVisitorScheme(scheme)
	}
	return out
}

func cloneTickets(input map[string]Ticket) map[string]Ticket {
	out := make(map[string]Ticket, len(input))
	for key, value := range input {
		value.Attachments = append([]TicketAttachment(nil), value.Attachments...)
		out[key] = value
	}
	return out
}

func cloneMap[T any](input map[string]T) map[string]T {
	out := make(map[string]T, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func cloneSliceMap[T any](input map[string][]T) map[string][]T {
	out := make(map[string][]T, len(input))
	for key, value := range input {
		copied := make([]T, len(value))
		copy(copied, value)
		out[key] = copied
	}
	return out
}

func usersToSnapshot(input map[string]User) map[string]fileUser {
	out := make(map[string]fileUser, len(input))
	for key, value := range input {
		out[key] = fileUser{User: value, PasswordHash: value.PasswordHash, IdentityRevision: value.IdentityRevision}
	}
	return out
}

func usersFromSnapshot(input map[string]fileUser) map[string]User {
	out := make(map[string]User, len(input))
	for key, value := range input {
		user := value.User
		user.PasswordHash = value.PasswordHash
		user.IdentityRevision = value.IdentityRevision
		out[key] = user
	}
	return out
}

func sessionsToSnapshot(input map[string]Session) map[string]fileSession {
	out := make(map[string]fileSession, len(input))
	for key, value := range input {
		out[key] = fileSession{Session: value, TokenHash: value.TokenHash}
	}
	return out
}

func sessionsFromSnapshot(input map[string]fileSession) map[string]Session {
	out := make(map[string]Session, len(input))
	for key, value := range input {
		session := value.Session
		session.TokenHash = value.TokenHash
		out[key] = session
	}
	return out
}

func shopifyInstallationsToSnapshot(input map[string]ShopifyInstallation) map[string]fileShopifyInstallation {
	out := make(map[string]fileShopifyInstallation, len(input))
	for key, value := range input {
		out[key] = fileShopifyInstallation{ShopifyInstallation: value, AccessToken: value.AccessToken}
	}
	return out
}

func shopifyInstallationsFromSnapshot(input map[string]fileShopifyInstallation) map[string]ShopifyInstallation {
	out := make(map[string]ShopifyInstallation, len(input))
	for key, value := range input {
		installation := value.ShopifyInstallation
		installation.AccessToken = value.AccessToken
		out[key] = installation
	}
	return out
}

func shopifyAppProfilesToSnapshot(input map[string]ShopifyAppProfile) map[string]fileShopifyAppProfile {
	out := make(map[string]fileShopifyAppProfile, len(input))
	for key, value := range input {
		out[key] = fileShopifyAppProfile{
			ShopifyAppProfile:        value,
			EncryptedClientSecret:    value.EncryptedClientSecret,
			EncryptedAutomationToken: value.EncryptedAutomationToken,
		}
	}
	return out
}

func shopifyAppProfilesFromSnapshot(input map[string]fileShopifyAppProfile) map[string]ShopifyAppProfile {
	out := make(map[string]ShopifyAppProfile, len(input))
	for key, value := range input {
		profile := value.ShopifyAppProfile
		profile.EncryptedClientSecret = value.EncryptedClientSecret
		profile.EncryptedAutomationToken = value.EncryptedAutomationToken
		profile.HasClientSecret = profile.EncryptedClientSecret != ""
		profile.HasAutomationToken = profile.EncryptedAutomationToken != ""
		out[key] = profile
	}
	return out
}

func emailInstallationsToSnapshot(input map[string]EmailInstallation) map[string]fileEmailInstallation {
	out := make(map[string]fileEmailInstallation, len(input))
	for key, value := range input {
		out[key] = fileEmailInstallation{EmailInstallation: value, AccessToken: value.AccessToken, RefreshToken: value.RefreshToken}
	}
	return out
}

func emailInstallationsFromSnapshot(input map[string]fileEmailInstallation) map[string]EmailInstallation {
	out := make(map[string]EmailInstallation, len(input))
	for key, value := range input {
		installation := value.EmailInstallation
		installation.AccessToken = value.AccessToken
		installation.RefreshToken = value.RefreshToken
		out[key] = installation
	}
	return out
}

func (s *FileStore) BindERPTenant(ctx context.Context, tenantID string) error {
	existing, err := s.MemoryStore.GetERPTenantBinding(ctx)
	if err == nil {
		if existing == strings.TrimSpace(tenantID) {
			return nil
		}
		return fmt.Errorf("%w: customer service store is bound to another ERP tenant", ErrForbidden)
	}
	if !errors.Is(err, ErrNotFound) {
		return err
	}
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.BindERPTenant(ctx, tenantID)
	})
}

func (s *FileStore) CreateUser(ctx context.Context, input User) (User, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (User, error) {
		return candidate.CreateUser(ctx, input)
	})
}

func (s *FileStore) UpdateUser(ctx context.Context, id string, input User) (User, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (User, error) {
		return candidate.UpdateUser(ctx, id, input)
	})
}

func (s *FileStore) CreateAccountAuditLog(ctx context.Context, input AccountAuditLog) (AccountAuditLog, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (AccountAuditLog, error) {
		return candidate.CreateAccountAuditLog(ctx, input)
	})
}

func (s *FileStore) SetUserReceptionOnline(ctx context.Context, id string, online bool) (User, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (User, error) {
		return candidate.SetUserReceptionOnline(ctx, id, online)
	})
}

func (s *FileStore) DeleteUser(ctx context.Context, id string) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.DeleteUser(ctx, id)
	})
}

func (s *FileStore) CreateSession(ctx context.Context, input Session) (Session, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Session, error) {
		return candidate.CreateSession(ctx, input)
	})
}

func (s *FileStore) DeleteSession(ctx context.Context, tokenHash string) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.DeleteSession(ctx, tokenHash)
	})
}

func (s *FileStore) AssignUserToShop(ctx context.Context, shopID string, userID string) (ShopAgent, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (ShopAgent, error) {
		return candidate.AssignUserToShop(ctx, shopID, userID)
	})
}

func (s *FileStore) UnassignUserFromShop(ctx context.Context, shopID string, userID string) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.UnassignUserFromShop(ctx, shopID, userID)
	})
}

func (s *FileStore) CreateShop(ctx context.Context, input Shop) (Shop, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Shop, error) {
		return candidate.CreateShop(ctx, input)
	})
}

func (s *FileStore) UpdateShop(ctx context.Context, id string, input Shop) (Shop, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Shop, error) {
		return candidate.UpdateShop(ctx, id, input)
	})
}

func (s *FileStore) DeleteShop(ctx context.Context, id string) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.DeleteShop(ctx, id)
	})
}

func (s *FileStore) CreateShopSource(ctx context.Context, input ShopSource) (ShopSource, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (ShopSource, error) {
		return candidate.CreateShopSource(ctx, input)
	})
}

func (s *FileStore) SetShopSourceStatus(ctx context.Context, shopID string, sourceID string, status string) (ShopSource, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (ShopSource, error) {
		return candidate.SetShopSourceStatus(ctx, shopID, sourceID, status)
	})
}

func (s *FileStore) UpdateShopSource(ctx context.Context, shopID string, sourceID string, input ShopSource) (ShopSource, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (ShopSource, error) {
		return candidate.UpdateShopSource(ctx, shopID, sourceID, input)
	})
}

func (s *FileStore) MutateShopSourceMetadata(ctx context.Context, shopID string, sourceID string, mutate func(map[string]string) map[string]string) (ShopSource, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (ShopSource, error) {
		return candidate.MutateShopSourceMetadata(ctx, shopID, sourceID, mutate)
	})
}

func (s *FileStore) CreateVisitorScheme(ctx context.Context, input VisitorScheme) (VisitorScheme, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (VisitorScheme, error) {
		return candidate.CreateVisitorScheme(ctx, input)
	})
}

func (s *FileStore) UpdateVisitorScheme(ctx context.Context, id string, input VisitorScheme) (VisitorScheme, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (VisitorScheme, error) {
		return candidate.UpdateVisitorScheme(ctx, id, input)
	})
}

func (s *FileStore) ApplyVisitorScheme(ctx context.Context, id string, shopIDs []string) (VisitorScheme, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (VisitorScheme, error) {
		return candidate.ApplyVisitorScheme(ctx, id, shopIDs)
	})
}

func (s *FileStore) DeleteVisitorScheme(ctx context.Context, id string) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.DeleteVisitorScheme(ctx, id)
	})
}

func (s *FileStore) SaveShopifyInstallation(ctx context.Context, input ShopifyInstallation) (ShopifyInstallation, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (ShopifyInstallation, error) {
		return candidate.SaveShopifyInstallation(ctx, input)
	})
}

func (s *FileStore) DeleteShopifyInstallationByDomain(ctx context.Context, shopDomain string) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.DeleteShopifyInstallationByDomain(ctx, shopDomain)
	})
}

func (s *FileStore) SaveShopifyAppProfile(ctx context.Context, input ShopifyAppProfile) (ShopifyAppProfile, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (ShopifyAppProfile, error) {
		return candidate.SaveShopifyAppProfile(ctx, input)
	})
}

func (s *FileStore) DeleteShopifyAppProfile(ctx context.Context, shopID string) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.DeleteShopifyAppProfile(ctx, shopID)
	})
}

func (s *FileStore) SaveEmailInstallation(ctx context.Context, input EmailInstallation) (EmailInstallation, error) {
	input.AccessToken = strings.TrimSpace(input.AccessToken)
	input.RefreshToken = strings.TrimSpace(input.RefreshToken)
	encryptedAccessToken, err := encryptEmailCredential(input.AccessToken)
	if err != nil {
		return EmailInstallation{}, err
	}
	encryptedRefreshToken, err := encryptEmailCredential(input.RefreshToken)
	if err != nil {
		return EmailInstallation{}, err
	}
	input.AccessToken = encryptedAccessToken
	input.RefreshToken = encryptedRefreshToken
	stored, err := mutateFileStore(ctx, s, func(candidate *MemoryStore) (EmailInstallation, error) {
		return candidate.SaveEmailInstallation(ctx, input)
	})
	if err != nil {
		return EmailInstallation{}, err
	}
	decrypted, err := decryptEmailInstallationCredentials(stored)
	if err != nil {
		return EmailInstallation{}, err
	}
	return decrypted, nil
}

func (s *FileStore) GetEmailInstallation(ctx context.Context, shopID string, mailbox string) (EmailInstallation, error) {
	stored, err := s.MemoryStore.GetEmailInstallation(ctx, shopID, mailbox)
	if err != nil {
		return EmailInstallation{}, err
	}
	return decryptEmailInstallationCredentials(stored)
}

func (s *FileStore) MigrateEmailInstallationCredentials(ctx context.Context) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		candidate.mu.Lock()
		defer candidate.mu.Unlock()
		for key, installation := range candidate.emailInstalls {
			encryptedAccessToken, err := encryptEmailCredential(installation.AccessToken)
			if err != nil {
				return err
			}
			encryptedRefreshToken, err := encryptEmailCredential(installation.RefreshToken)
			if err != nil {
				return err
			}
			installation.AccessToken = encryptedAccessToken
			installation.RefreshToken = encryptedRefreshToken
			candidate.emailInstalls[key] = installation
		}
		return nil
	})
}

func (s *FileStore) SaveEmailHistoryImportJob(ctx context.Context, input EmailHistoryImportJob) (EmailHistoryImportJob, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (EmailHistoryImportJob, error) {
		return candidate.SaveEmailHistoryImportJob(ctx, input)
	})
}

func (s *FileStore) DisconnectEmailSource(ctx context.Context, shopID string, sourceID string) (ShopSource, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (ShopSource, error) {
		return candidate.DisconnectEmailSource(ctx, shopID, sourceID)
	})
}

func (s *FileStore) CreateConversation(ctx context.Context, input Conversation) (Conversation, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Conversation, error) {
		return candidate.CreateConversation(ctx, input)
	})
}

func (s *FileStore) UpdateConversation(ctx context.Context, id string, input ConversationUpdate) (Conversation, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Conversation, error) {
		return candidate.UpdateConversation(ctx, id, input)
	})
}

func (s *FileStore) PromoteSystemConversation(ctx context.Context, id string, replyAllowed bool, classification string) (Conversation, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Conversation, error) {
		return candidate.PromoteSystemConversation(ctx, id, replyAllowed, classification)
	})
}

func (s *FileStore) ReplaceConversationEmailTags(ctx context.Context, conversationID string, tags []EmailProcessingTag, updatedBy string) ([]EmailProcessingTag, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) ([]EmailProcessingTag, error) {
		return candidate.ReplaceConversationEmailTags(ctx, conversationID, tags, updatedBy)
	})
}

func (s *FileStore) SaveRecordCategories(ctx context.Context, input []RecordCategoryOption) ([]RecordCategoryOption, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) ([]RecordCategoryOption, error) {
		return candidate.SaveRecordCategories(ctx, input)
	})
}

func (s *FileStore) ClaimConversation(ctx context.Context, id string, userID string) (Conversation, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Conversation, error) {
		return candidate.ClaimConversation(ctx, id, userID)
	})
}

func (s *FileStore) CloseConversation(ctx context.Context, id string, userID string) (Conversation, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Conversation, error) {
		return candidate.CloseConversation(ctx, id, userID)
	})
}

func (s *FileStore) CloseInactiveCustomerConversations(ctx context.Context, before time.Time) ([]Conversation, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) ([]Conversation, error) {
		return candidate.CloseInactiveCustomerConversations(ctx, before)
	})
}

func (s *FileStore) ReopenConversation(ctx context.Context, id string, userID string) (Conversation, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Conversation, error) {
		return candidate.ReopenConversation(ctx, id, userID)
	})
}

func (s *FileStore) TransferConversation(ctx context.Context, id, fromAgentID, targetAgentID string) (Conversation, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Conversation, error) {
		return candidate.TransferConversation(ctx, id, fromAgentID, targetAgentID)
	})
}

func (s *FileStore) CreateTransferRequest(ctx context.Context, input TransferRequest) (TransferRequest, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (TransferRequest, error) {
		return candidate.CreateTransferRequest(ctx, input)
	})
}

func (s *FileStore) ResolveTransferRequest(ctx context.Context, id, status, resolvedBy string) (TransferRequest, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (TransferRequest, error) {
		return candidate.ResolveTransferRequest(ctx, id, status, resolvedBy)
	})
}

func (s *FileStore) CreateTicket(ctx context.Context, input Ticket) (Ticket, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Ticket, error) {
		return candidate.CreateTicket(ctx, input)
	})
}

func (s *FileStore) UpdateTicket(ctx context.Context, id string, input TicketUpdate) (Ticket, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Ticket, error) {
		return candidate.UpdateTicket(ctx, id, input)
	})
}

func (s *FileStore) AcceptTicket(ctx context.Context, id string, userID string) (Ticket, *Conversation, error) {
	type result struct {
		ticket       Ticket
		conversation *Conversation
	}
	out, err := mutateFileStore(ctx, s, func(candidate *MemoryStore) (result, error) {
		ticket, conversation, mutateErr := candidate.AcceptTicket(ctx, id, userID)
		return result{ticket: ticket, conversation: conversation}, mutateErr
	})
	if err != nil {
		return out.ticket, out.conversation, err
	}
	return out.ticket, out.conversation, nil
}

func (s *FileStore) AddTicketComment(ctx context.Context, input TicketComment) (TicketComment, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (TicketComment, error) {
		return candidate.AddTicketComment(ctx, input)
	})
}

func (s *FileStore) AddMessage(ctx context.Context, input Message) (Message, Conversation, error) {
	type result struct {
		message      Message
		conversation Conversation
	}
	out, err := mutateFileStore(ctx, s, func(candidate *MemoryStore) (result, error) {
		message, conversation, mutateErr := candidate.AddMessage(ctx, input)
		return result{message: message, conversation: conversation}, mutateErr
	})
	if err != nil {
		return out.message, out.conversation, err
	}
	return out.message, out.conversation, nil
}

func (s *FileStore) AddAgentMessage(ctx context.Context, input Message, userID string) (Message, Conversation, error) {
	type result struct {
		message      Message
		conversation Conversation
	}
	out, err := mutateFileStore(ctx, s, func(candidate *MemoryStore) (result, error) {
		message, conversation, mutateErr := candidate.AddAgentMessage(ctx, input, userID)
		return result{message: message, conversation: conversation}, mutateErr
	})
	if err != nil {
		return out.message, out.conversation, err
	}
	return out.message, out.conversation, nil
}

func (s *FileStore) UpdateMessageMetadata(ctx context.Context, conversationID string, messageID string, patch map[string]string) (Message, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (Message, error) {
		return candidate.UpdateMessageMetadata(ctx, conversationID, messageID, patch)
	})
}

func (s *FileStore) MarkConversationRead(ctx context.Context, userID string, conversationID string, readAt time.Time) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.MarkConversationRead(ctx, userID, conversationID, readAt)
	})
}

func (s *FileStore) CreateKnowledge(ctx context.Context, input KnowledgeEntry) (KnowledgeEntry, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (KnowledgeEntry, error) {
		return candidate.CreateKnowledge(ctx, input)
	})
}

func (s *FileStore) UpdateKnowledge(ctx context.Context, id string, input KnowledgeUpdate) (KnowledgeEntry, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (KnowledgeEntry, error) {
		return candidate.UpdateKnowledge(ctx, id, input)
	})
}

func (s *FileStore) ApplyKnowledgeRevision(ctx context.Context, revisionID string, reviewedBy string, reviewNote string) (KnowledgeEntry, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (KnowledgeEntry, error) {
		return candidate.ApplyKnowledgeRevision(ctx, revisionID, reviewedBy, reviewNote)
	})
}

func (s *FileStore) DeleteKnowledge(ctx context.Context, id string) error {
	return mutateFileStoreError(ctx, s, func(candidate *MemoryStore) error {
		return candidate.DeleteKnowledge(ctx, id)
	})
}

func (s *FileStore) SaveAISettings(ctx context.Context, input AISettings) (AISettings, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (AISettings, error) {
		return candidate.SaveAISettings(ctx, input)
	})
}

func (s *FileStore) SaveLogisticsSettings(ctx context.Context, input LogisticsSettings) (LogisticsSettings, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (LogisticsSettings, error) {
		return candidate.SaveLogisticsSettings(ctx, input)
	})
}

func (s *FileStore) SaveCuiqiuDomainSettings(ctx context.Context, input CuiqiuDomainSettings) (CuiqiuDomainSettings, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (CuiqiuDomainSettings, error) {
		return candidate.SaveCuiqiuDomainSettings(ctx, input)
	})
}

func cuiqiuDomainSettingsToSnapshot(input map[string]CuiqiuDomainSettings) map[string]fileCuiqiuDomainSettings {
	out := make(map[string]fileCuiqiuDomainSettings, len(input))
	for domain, settings := range input {
		out[domain] = fileCuiqiuDomainSettings{CuiqiuDomainSettings: settings, EncryptedToken: settings.EncryptedToken}
	}
	return out
}

func (s *FileStore) SaveMonitorWorkSchedule(ctx context.Context, input MonitorWorkSchedule) (MonitorWorkSchedule, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (MonitorWorkSchedule, error) {
		return candidate.SaveMonitorWorkSchedule(ctx, input)
	})
}

func (s *FileStore) SaveSLASettings(ctx context.Context, input SLASettings) (SLASettings, error) {
	return mutateFileStore(ctx, s, func(candidate *MemoryStore) (SLASettings, error) {
		return candidate.SaveSLASettings(ctx, input)
	})
}

func cloneMonitorWorkSchedules(input []MonitorWorkSchedule) []MonitorWorkSchedule {
	out := make([]MonitorWorkSchedule, len(input))
	for index, item := range input {
		out[index] = item
		out[index].Weekdays = append([]int(nil), item.Weekdays...)
	}
	return out
}
