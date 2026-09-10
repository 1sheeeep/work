package platform

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/emersion/go-imap"
)

type fakeStandardIMAPRealtimeClient struct {
	selectCalls atomic.Int32
	waitCalls   atomic.Int32
	logoutCalls atomic.Int32
	waitError   error
	cancelAfter int32
	cancel      context.CancelFunc
}

func (client *fakeStandardIMAPRealtimeClient) Select(string, bool) (*imap.MailboxStatus, error) {
	client.selectCalls.Add(1)
	return &imap.MailboxStatus{UidValidity: 1, UidNext: 1}, nil
}

func (*fakeStandardIMAPRealtimeClient) UidSearch(*imap.SearchCriteria) ([]uint32, error) {
	return nil, nil
}

func (*fakeStandardIMAPRealtimeClient) UidFetch(_ *imap.SeqSet, _ []imap.FetchItem, messages chan *imap.Message) error {
	close(messages)
	return nil
}

func (client *fakeStandardIMAPRealtimeClient) WaitForMailboxUpdate(context.Context) error {
	calls := client.waitCalls.Add(1)
	if client.cancel != nil && client.cancelAfter > 0 && calls >= client.cancelAfter {
		client.cancel()
	}
	return client.waitError
}

func (client *fakeStandardIMAPRealtimeClient) Logout() error {
	client.logoutCalls.Add(1)
	return nil
}

func TestStandardIMAPRealtimeSessionReusesConnection(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Realtime Store"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: standardMailProvider,
		Address: "support@163.com", Status: SourceStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	client := &fakeStandardIMAPRealtimeClient{cancelAfter: 3, cancel: cancel}
	err = NewServer(store).runStandardIMAPRealtimeSession(ctx, source, client)
	cancel()
	if !errors.Is(err, context.Canceled) && !errors.Is(err, errStandardIMAPRealtimeSourceInactive) {
		t.Fatalf("unexpected session result: %v", err)
	}
	if client.waitCalls.Load() < 2 || client.selectCalls.Load() < 2 {
		t.Fatalf("connection was not reused: waits=%d select=%d", client.waitCalls.Load(), client.selectCalls.Load())
	}
}

func TestStandardIMAPRealtimeWorkerReconnectsAfterSessionFailure(t *testing.T) {
	originalOpen := openStandardIMAPRealtime
	originalJitter := standardIMAPRealtimeInitialJitter
	originalRetryDelays := standardIMAPRealtimeRetryDelays
	standardIMAPRealtimeInitialJitter = 0
	standardIMAPRealtimeRetryDelays = []time.Duration{time.Millisecond, 2 * time.Millisecond}
	t.Cleanup(func() {
		openStandardIMAPRealtime = originalOpen
		standardIMAPRealtimeInitialJitter = originalJitter
		standardIMAPRealtimeRetryDelays = originalRetryDelays
	})

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Reconnect Store"})
	if err != nil {
		t.Fatal(err)
	}
	config := standardMailConfig{Preset: standardMailPresets["163.com"], Mailbox: "support@163.com", Credential: "auth-code"}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: standardMailProvider,
		Address: config.Mailbox, Status: SourceStatusActive, Metadata: standardMailMetadata(config, standardIMAPBaseline{}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID: shop.ID, Mailbox: config.Mailbox, Provider: standardMailProvider, AccessToken: config.Credential,
	}); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var opens atomic.Int32
	openStandardIMAPRealtime = func(context.Context, standardMailConfig) (standardIMAPRealtimeClient, error) {
		count := opens.Add(1)
		if count >= 2 {
			cancel()
		}
		return &fakeStandardIMAPRealtimeClient{waitError: errors.New("connection closed")}, nil
	}
	NewServer(store).runStandardIMAPRealtimeWorker(ctx, source)
	if opens.Load() < 2 {
		t.Fatalf("worker did not reconnect after failure: opens=%d", opens.Load())
	}
}

func TestStandardIMAPRealtimeSupervisorWakesForNewSource(t *testing.T) {
	originalOpen := openStandardIMAPRealtime
	t.Cleanup(func() { openStandardIMAPRealtime = originalOpen })

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Wake Store"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	opened := make(chan struct{}, 1)
	openStandardIMAPRealtime = func(context.Context, standardMailConfig) (standardIMAPRealtimeClient, error) {
		select {
		case opened <- struct{}{}:
		default:
		}
		return &fakeStandardIMAPRealtimeClient{waitError: errors.New("connection closed")}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server.StartStandardIMAPRealtime(ctx)
	time.Sleep(20 * time.Millisecond)

	config := standardMailConfig{Preset: standardMailPresets["163.com"], Mailbox: "wake@163.com", Credential: "auth-code"}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: standardMailProvider,
		Address: config.Mailbox, Status: SourceStatusActive, Metadata: standardMailMetadata(config, standardIMAPBaseline{}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID: shop.ID, Mailbox: config.Mailbox, Provider: standardMailProvider, AccessToken: config.Credential,
	}); err != nil {
		t.Fatal(err)
	}
	server.notifyStandardIMAPSupervisor()
	select {
	case <-opened:
	case <-time.After(time.Second):
		t.Fatalf("new source %s did not wake the IMAP supervisor", source.ID)
	}
}

func TestStandardIMAPRealtimeWorkerStopsAfterBoundedTemporaryFailures(t *testing.T) {
	originalOpen := openStandardIMAPRealtime
	originalJitter := standardIMAPRealtimeInitialJitter
	originalRetryDelays := standardIMAPRealtimeRetryDelays
	standardIMAPRealtimeInitialJitter = 0
	standardIMAPRealtimeRetryDelays = []time.Duration{time.Millisecond, 2 * time.Millisecond}
	t.Cleanup(func() {
		openStandardIMAPRealtime = originalOpen
		standardIMAPRealtimeInitialJitter = originalJitter
		standardIMAPRealtimeRetryDelays = originalRetryDelays
	})

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Bounded Retry Store"})
	if err != nil {
		t.Fatal(err)
	}
	config := standardMailConfig{Preset: standardMailPresets["126.com"], Mailbox: "retry@126.com", Credential: "auth-code"}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: standardMailProvider,
		Address: config.Mailbox, Status: SourceStatusActive, Metadata: standardMailMetadata(config, standardIMAPBaseline{}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID: shop.ID, Mailbox: config.Mailbox, Provider: standardMailProvider, AccessToken: config.Credential,
	}); err != nil {
		t.Fatal(err)
	}
	var opens atomic.Int32
	openStandardIMAPRealtime = func(context.Context, standardMailConfig) (standardIMAPRealtimeClient, error) {
		opens.Add(1)
		return nil, errors.New("dial tcp: i/o timeout")
	}
	NewServer(store).runStandardIMAPRealtimeWorker(context.Background(), source)
	if opens.Load() != 3 {
		t.Fatalf("opens=%d want=3", opens.Load())
	}
	updated, err := store.GetShopSource(context.Background(), shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[emailRetryStateKey] != emailRetryStateManualRecoveryRequired || updated.Metadata[emailRetryNextAtKey] != "" {
		t.Fatalf("temporary failure did not open the manual recovery circuit: %#v", updated.Metadata)
	}
	if updated.Metadata[standardIMAPRealtimeFailureCountKey] != "3" || updated.Metadata[emailRetryErrorCodeKey] != "imap_timeout" {
		t.Fatalf("unexpected bounded retry metadata: %#v", updated.Metadata)
	}
}

func TestStandardIMAPRealtimeWorkerStopsImmediatelyForInvalidAuthorization(t *testing.T) {
	originalOpen := openStandardIMAPRealtime
	originalJitter := standardIMAPRealtimeInitialJitter
	standardIMAPRealtimeInitialJitter = 0
	t.Cleanup(func() {
		openStandardIMAPRealtime = originalOpen
		standardIMAPRealtimeInitialJitter = originalJitter
	})

	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Auth Stop Store"})
	config := standardMailConfig{Preset: standardMailPresets["qq.com"], Mailbox: "auth@qq.com", Credential: "bad-code"}
	source, _ := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: standardMailProvider,
		Address: config.Mailbox, Status: SourceStatusActive, Metadata: standardMailMetadata(config, standardIMAPBaseline{}),
	})
	_, _ = store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID: shop.ID, Mailbox: config.Mailbox, Provider: standardMailProvider, AccessToken: config.Credential,
	})
	var opens atomic.Int32
	openStandardIMAPRealtime = func(context.Context, standardMailConfig) (standardIMAPRealtimeClient, error) {
		opens.Add(1)
		return nil, errors.New("authentication failed: invalid credentials")
	}
	NewServer(store).runStandardIMAPRealtimeWorker(context.Background(), source)
	updated, _ := store.GetShopSource(context.Background(), shop.ID, source.ID)
	if opens.Load() != 1 || updated.Metadata[emailRetryStateKey] != emailRetryStateReauthorizationNeeded {
		t.Fatalf("authorization failure should stop immediately: opens=%d metadata=%#v", opens.Load(), updated.Metadata)
	}
}

func TestRecoverStandardIMAPSourceClearsStoppedState(t *testing.T) {
	originalVerify := verifyStandardIMAPConnection
	t.Cleanup(func() { verifyStandardIMAPConnection = originalVerify })
	verifyStandardIMAPConnection = func(context.Context, standardMailConfig) (standardIMAPBaseline, error) {
		return standardIMAPBaseline{UIDValidity: 7, LastUID: 9}, nil
	}

	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Manual Recovery Store"})
	config := standardMailConfig{Preset: standardMailPresets["139.com"], Mailbox: "recover@139.com", Credential: "auth-code"}
	metadata := standardMailMetadata(config, standardIMAPBaseline{UIDValidity: 7, LastUID: 8})
	metadata[emailRetryStateKey] = emailRetryStateManualRecoveryRequired
	metadata[emailRetryErrorCodeKey] = "imap_timeout"
	metadata[standardIMAPRealtimeFailureCountKey] = "3"
	metadata["email_last_error"] = "dial tcp: i/o timeout"
	source, _ := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: standardMailProvider,
		Address: config.Mailbox, Status: SourceStatusActive, Metadata: metadata,
	})
	_, _ = store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID: shop.ID, Mailbox: config.Mailbox, Provider: standardMailProvider, AccessToken: config.Credential,
	})
	updated, err := NewServer(store).recoverStandardIMAPSource(context.Background(), shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[emailRetryStateKey] != "" || updated.Metadata[standardIMAPRealtimeFailureCountKey] != "" || updated.Metadata["email_last_error"] != "" {
		t.Fatalf("manual recovery state was not cleared: %#v", updated.Metadata)
	}
	if updated.Metadata[standardIMAPLastUIDKey] != "8" || updated.Metadata["email_sync_status"] != "pending" {
		t.Fatalf("manual recovery changed cursor or status incorrectly: %#v", updated.Metadata)
	}
}

func TestStandardIMAPRealtimeJitterHandlesSubMillisecondWindow(t *testing.T) {
	if got := standardIMAPRealtimeJitter("source-1", 250*time.Microsecond); got != 0 {
		t.Fatalf("sub-millisecond jitter = %s, want 0", got)
	}
}

func TestRefreshEmailStatisticsSyncsExactStandardMailbox(t *testing.T) {
	originalFetch := fetchStandardIMAPSyncBatch
	t.Cleanup(func() { fetchStandardIMAPSyncBatch = originalFetch })

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Statistics Store"})
	if err != nil {
		t.Fatal(err)
	}
	config := standardMailConfig{Preset: standardMailPresets["126.com"], Mailbox: "finance@126.com", Credential: "auth-code"}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: standardMailProvider,
		Address: config.Mailbox, Status: SourceStatusActive, Metadata: standardMailMetadata(config, standardIMAPBaseline{}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID: shop.ID, Mailbox: config.Mailbox, Provider: standardMailProvider, AccessToken: config.Credential,
	}); err != nil {
		t.Fatal(err)
	}
	var fetches atomic.Int32
	fetchStandardIMAPSyncBatch = func(_ context.Context, _ string, mailbox string, gotSource ShopSource) (emailProviderSyncBatch, error) {
		fetches.Add(1)
		if mailbox != config.Mailbox || gotSource.ID != source.ID {
			t.Fatalf("unexpected exact-mailbox refresh: mailbox=%s source=%s", mailbox, gotSource.ID)
		}
		return emailProviderSyncBatch{Messages: []incomingEmailMessage{{
			ExternalConversationID: "finance-thread", SourceMessageID: "imap_smtp:1:1",
			CustomerName: "Vendor", CustomerEmail: "vendor@example.com",
			SenderName: "Vendor", SenderEmail: "vendor@example.com",
			Subject: "Invoice", Body: "Invoice received", Classification: ConversationKindCustomer,
			ReceivedAt: time.Now().UTC(),
		}}}, nil
	}
	server := NewServer(store)
	missing, err := server.refreshEmailStatisticsSource(context.Background(), User{Role: UserRoleAdmin}, "missing-source", " Finance@126.com ")
	if err != nil {
		t.Fatal(err)
	}
	if missing.Synced || fetches.Load() != 0 {
		t.Fatalf("mismatched source must not be refreshed: %#v fetches=%d", missing, fetches.Load())
	}
	result, err := server.refreshEmailStatisticsSource(context.Background(), User{Role: UserRoleAdmin}, source.ID, " Finance@126.com ")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Synced || result.MessagesCreated != 1 || fetches.Load() != 1 {
		t.Fatalf("unexpected refresh result: %#v fetches=%d", result, fetches.Load())
	}
}
