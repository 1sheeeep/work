package appcore

type ActionResult struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Data  any    `json:"data,omitempty"`
}

func OK(data any) ActionResult {
	return ActionResult{OK: true, Data: data}
}

func Fail(message string) ActionResult {
	return ActionResult{OK: false, Error: message}
}

type BootstrapState struct {
	RootDir        string     `json:"rootDir"`
	DataDir        string     `json:"dataDir"`
	ConfigPath     string     `json:"configPath"`
	LogPath        string     `json:"logPath"`
	Settings       Settings   `json:"settings"`
	LastOpenResult OpenResult `json:"lastOpenResult"`
}

type Settings struct {
	ActiveAdapter       string           `json:"activeAdapter"`
	Zhanfu              map[string]any   `json:"zhanfu"`
	BitBrowser          map[string]any   `json:"bitbrowser"`
	AdsPower            map[string]any   `json:"adspower"`
	ZhanfuInstances     []map[string]any `json:"zhanfuInstances"`
	BitBrowserInstances []map[string]any `json:"bitbrowserInstances"`
	AdsPowerInstances   []map[string]any `json:"adspowerInstances"`
	AI                  map[string]any   `json:"ai"`
	Knowledge           map[string]any   `json:"knowledge"`
	Mail                map[string]any   `json:"mail"`
	Raw                 map[string]any   `json:"raw,omitempty"`
}

type Shop struct {
	MallID            string         `json:"mallId"`
	DisplayName       string         `json:"displayName"`
	AdapterName       string         `json:"adapterName"`
	AdapterInstance   string         `json:"adapterInstance"`
	SourceLabel       string         `json:"sourceLabel"`
	Status            string         `json:"status,omitempty"`
	EnvironmentID     string         `json:"environmentId,omitempty"`
	EnvironmentIP     string         `json:"environmentIp,omitempty"`
	MailProvider      string         `json:"mailProvider,omitempty"`
	MailAccount       string         `json:"mailAccount,omitempty"`
	ServiceEmail      string         `json:"serviceEmail,omitempty"`
	MailAccountSource string         `json:"mailAccountSource,omitempty"`
	MailNetworkMode   string         `json:"mailNetworkMode,omitempty"`
	MailProxySource   string         `json:"mailProxySource,omitempty"`
	APIAllowed        bool           `json:"apiAllowed,omitempty"`
	APIToggleable     bool           `json:"apiToggleable"`
	APIDisabled       bool           `json:"apiDisabled,omitempty"`
	APIDisabledReason string         `json:"apiDisabledReason,omitempty"`
	ProxyConfigured   bool           `json:"proxyConfigured,omitempty"`
	ProxyIPMatched    bool           `json:"proxyIpMatched,omitempty"`
	ProxyLastTestedAt string         `json:"proxyLastTestedAt,omitempty"`
	ProxyLastError    string         `json:"proxyLastError,omitempty"`
	APIAuthorized     bool           `json:"apiAuthorized,omitempty"`
	APILastReadAt     string         `json:"apiLastReadAt,omitempty"`
	APILastError      string         `json:"apiLastError,omitempty"`
	Raw               map[string]any `json:"raw,omitempty"`
}

type OpenResult struct {
	MallID          string         `json:"mallId"`
	ShopName        string         `json:"shopName"`
	WebDriverURL    string         `json:"webDriverUrl"`
	DebuggerAddress string         `json:"debuggerAddress"`
	AdapterName     string         `json:"adapterName"`
	AdapterInstance string         `json:"adapterInstance"`
	OpenResponse    map[string]any `json:"openResponse,omitempty"`
	WebDriverRaw    map[string]any `json:"webDriverRaw,omitempty"`
}

type BrowserStatus struct {
	AdapterName      string `json:"adapterName"`
	AdapterInstance  string `json:"adapterInstance"`
	Label            string `json:"label"`
	OK               bool   `json:"ok"`
	ShopCount        int    `json:"shopCount"`
	Error            string `json:"error,omitempty"`
	BaseURL          string `json:"baseUrl,omitempty"`
	Port             int    `json:"port,omitempty"`
	ClientPath       string `json:"clientPath,omitempty"`
	ClientPathSource string `json:"clientPathSource,omitempty"`
	ClientPathError  string `json:"clientPathError,omitempty"`
}

type Conversation struct {
	ID                    string        `json:"id"`
	CustomerName          string        `json:"customerName"`
	CustomerFullName      string        `json:"customerFullName"`
	CustomerEmail         string        `json:"customerEmail"`
	Preview               string        `json:"preview"`
	Topic                 string        `json:"topic"`
	LastSeen              string        `json:"lastSeen"`
	ReceivedAt            string        `json:"receivedAt,omitempty"`
	Status                string        `json:"status"`
	SendStatus            string        `json:"sendStatus"`
	DetailLoaded          bool          `json:"detailLoaded"`
	Source                string        `json:"source"`
	EmailProvider         string        `json:"emailProvider,omitempty"`
	EmailAccount          string        `json:"emailAccount,omitempty"`
	EmailMessageID        string        `json:"emailMessageId,omitempty"`
	EmailThreadID         string        `json:"emailThreadId,omitempty"`
	EmailInternetID       string        `json:"emailInternetId,omitempty"`
	ShopKey               string        `json:"shopKey,omitempty"`
	ShopName              string        `json:"shopName,omitempty"`
	MallID                string        `json:"mallId,omitempty"`
	ConversationID        string        `json:"conversationId"`
	SourceURL             string        `json:"sourceUrl"`
	FetchedAt             string        `json:"fetchedAt"`
	RawLines              []string      `json:"rawLines"`
	Messages              []MessageItem `json:"messages"`
	CustomerProfileLines  []string      `json:"customerProfileLines"`
	OrderCartLines        []string      `json:"orderCartLines"`
	OrderLinks            []InfoLink    `json:"orderLinks"`
	ProductCards          []ProductCard `json:"productCards"`
	ProductInterestTitles []string      `json:"productInterestTitles,omitempty"`
	DataSources           []string      `json:"dataSources"`
	DataConflict          bool          `json:"dataConflict"`
	NeedsReview           bool          `json:"needsReview"`
	DetailFingerprint     string        `json:"detailFingerprint"`
	AIReply               string        `json:"aiReply"`
	AITranslation         string        `json:"aiTranslation"`
	AIReplyTranslation    string        `json:"aiReplyTranslation"`
	AIGenerated           bool          `json:"aiGenerated"`
	AIUsed                bool          `json:"aiUsed"`
	AICaution             bool          `json:"aiCaution"`
	RecordPrimary         string        `json:"recordPrimary,omitempty"`
	RecordSecondary       string        `json:"recordSecondary,omitempty"`
	RecordTertiary        string        `json:"recordTertiary,omitempty"`
	RecordRemark          string        `json:"recordRemark,omitempty"`
	RecordClassified      bool          `json:"recordClassified,omitempty"`
	DuplicateIndex        int           `json:"duplicateIndex"`
	DuplicateCount        int           `json:"duplicateCount"`
}

type MessageItem struct {
	Role        string         `json:"role"`
	Text        string         `json:"text"`
	Time        string         `json:"time,omitempty"`
	SenderName  string         `json:"senderName,omitempty"`
	SenderEmail string         `json:"senderEmail,omitempty"`
	Attachments []MessageAsset `json:"attachments,omitempty"`
}

type MessageAsset struct {
	Kind      string `json:"kind"`
	Path      string `json:"path"`
	URL       string `json:"url,omitempty"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	MimeType  string `json:"mimeType,omitempty"`
	Source    string `json:"source,omitempty"`
	MessageID string `json:"messageId,omitempty"`
}

type InfoLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
	Kind  string `json:"kind,omitempty"`
}

type ProductCard struct {
	Title    string `json:"title"`
	URL      string `json:"url,omitempty"`
	ImageURL string `json:"imageUrl,omitempty"`
	Manual   bool   `json:"manual,omitempty"`
}

type InboxResult struct {
	StoreSlug                string         `json:"storeSlug"`
	URL                      string         `json:"url"`
	Title                    string         `json:"title"`
	Status                   string         `json:"status,omitempty"`
	Warnings                 []string       `json:"warnings,omitempty"`
	ProviderErrors           []string       `json:"providerErrors,omitempty"`
	FallbackUsed             bool           `json:"fallbackUsed,omitempty"`
	IgnoredEmailCount        int            `json:"ignoredEmailCount,omitempty"`
	IgnoredEmailFingerprints []string       `json:"ignoredEmailFingerprints,omitempty"`
	Diagnostics              map[string]any `json:"diagnostics,omitempty"`
	ProductCards             []ProductCard  `json:"productCards,omitempty"`
	Conversations            []Conversation `json:"conversations"`
}

type EmailScanState struct {
	LastSuccessfulEmailScanAt string `json:"lastSuccessfulEmailScanAt,omitempty"`
	Provider                  string `json:"provider,omitempty"`
	Mailbox                   string `json:"mailbox,omitempty"`
	LastStatus                string `json:"lastStatus,omitempty"`
	LastCount                 int    `json:"lastCount,omitempty"`
	LastIgnored               int    `json:"lastIgnored,omitempty"`
	UpdatedAt                 string `json:"updatedAt,omitempty"`
}

type KnowledgeEntry struct {
	ID             string `json:"id"`
	Enabled        bool   `json:"enabled"`
	CreatedAt      string `json:"createdAt"`
	Source         string `json:"source"`
	ShopName       string `json:"shopName"`
	MallID         string `json:"mallId"`
	CustomerName   string `json:"customerName"`
	CustomerEmail  string `json:"customerEmail"`
	Topic          string `json:"topic"`
	ProblemSummary string `json:"problemSummary"`
	ContextExcerpt string `json:"contextExcerpt"`
	ReplyText      string `json:"replyText"`
	Notes          string `json:"notes"`
}

type SendResult struct {
	OK      bool   `json:"ok"`
	Source  string `json:"source"`
	Message string `json:"message"`
	SentAt  string `json:"sentAt"`
	Error   string `json:"error"`
}

type MailProxyImportResult struct {
	Imported int      `json:"imported"`
	Skipped  int      `json:"skipped"`
	Errors   []string `json:"errors,omitempty"`
}

type MailProxyTestResult struct {
	MallID      string `json:"mallId"`
	MailAccount string `json:"mailAccount"`
	ProxyIP     string `json:"proxyIp,omitempty"`
	ExpectedIP  string `json:"expectedIp,omitempty"`
	Matched     bool   `json:"matched"`
	ProxyURLSet bool   `json:"proxyUrlSet"`
	TestedAt    string `json:"testedAt,omitempty"`
	Error       string `json:"error,omitempty"`
}

type MailAuthStartResult struct {
	MallID        string `json:"mallId"`
	MailAccount   string `json:"mailAccount"`
	AuthURL       string `json:"authUrl"`
	RedirectURI   string `json:"redirectUri"`
	State         string `json:"state"`
	BrowserOpened bool   `json:"browserOpened"`
	OpenError     string `json:"openError,omitempty"`
}
