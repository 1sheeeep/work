package platform

import (
	"time"

	"shopify-support-platform/internal/records"
)

type RecordCategoryOption = records.CategoryOption

type AISettings struct {
	Enabled       bool      `json:"enabled"`
	BaseURL       string    `json:"baseUrl"`
	Model         string    `json:"model"`
	Models        []string  `json:"models"`
	Thinking      bool      `json:"thinking"`
	EncryptedKey  string    `json:"-"`
	HasAPIKey     bool      `json:"hasApiKey"`
	KeySource     string    `json:"keySource"`
	EncryptionOK  bool      `json:"encryptionConfigured"`
	LastTestedAt  time.Time `json:"lastTestedAt,omitempty"`
	LastTestOK    bool      `json:"lastTestOk"`
	LastTestError string    `json:"lastTestError,omitempty"`
	UpdatedAt     time.Time `json:"updatedAt,omitempty"`
}

type LogisticsSettings struct {
	Enabled            bool      `json:"enabled"`
	BaseURL            string    `json:"baseUrl"`
	EncryptedKey       string    `json:"-"`
	HasAPIKey          bool      `json:"hasApiKey"`
	EncryptionOK       bool      `json:"encryptionConfigured"`
	WebhookURL         string    `json:"webhookUrl"`
	AutoDraftEnabled   bool      `json:"autoDraftEnabled"`
	AutoSendEnabled    bool      `json:"autoSendEnabled"`
	ChatEnabled        bool      `json:"chatEnabled"`
	GmailEnabled       bool      `json:"gmailEnabled"`
	OutlookEnabled     bool      `json:"outlookEnabled"`
	ReplyCooldownHours int       `json:"replyCooldownHours"`
	LastTestedAt       time.Time `json:"lastTestedAt,omitempty"`
	LastTestOK         bool      `json:"lastTestOk"`
	LastTestError      string    `json:"lastTestError,omitempty"`
	UpdatedAt          time.Time `json:"updatedAt,omitempty"`
}

type CuiqiuDomainSettings struct {
	Domain            string    `json:"domain"`
	APIBase           string    `json:"apiBase"`
	EncryptedToken    string    `json:"-"`
	HasToken          bool      `json:"hasToken"`
	EncryptionOK      bool      `json:"encryptionConfigured"`
	DomainID          string    `json:"domainId,omitempty"`
	SMTPHost          string    `json:"smtpHost"`
	SMTPPort          int       `json:"smtpPort"`
	SMTPMode          string    `json:"smtpMode"`
	WebhookURL        string    `json:"webhookUrl,omitempty"`
	WebhookVerifiedAt time.Time `json:"webhookVerifiedAt,omitempty"`
	LastTestedAt      time.Time `json:"lastTestedAt,omitempty"`
	LastTestOK        bool      `json:"lastTestOk"`
	LastTestError     string    `json:"lastTestError,omitempty"`
	UpdatedAt         time.Time `json:"updatedAt,omitempty"`
}

type MonitorWorkSchedule struct {
	Enabled       bool      `json:"enabled"`
	Timezone      string    `json:"timezone"`
	StartMinute   int       `json:"startMinute"`
	EndMinute     int       `json:"endMinute"`
	Weekdays      []int     `json:"weekdays"`
	EffectiveFrom time.Time `json:"effectiveFrom,omitempty"`
	UpdatedAt     time.Time `json:"updatedAt,omitempty"`
}

type SLASettings struct {
	FirstResponseMinutes int       `json:"firstResponseMinutes"`
	ResponseMinutes      int       `json:"responseMinutes"`
	ResolutionMinutes    int       `json:"resolutionMinutes"`
	UpdatedAt            time.Time `json:"updatedAt,omitempty"`
}

type Shop struct {
	ID          string            `json:"id"`
	DisplayName string            `json:"displayName"`
	Platform    string            `json:"platform"`
	ExternalID  string            `json:"externalId,omitempty"`
	Status      string            `json:"status"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
}

type ShopSource struct {
	ID        string            `json:"id"`
	ShopID    string            `json:"shopId"`
	Type      string            `json:"type"`
	Provider  string            `json:"provider"`
	Address   string            `json:"address,omitempty"`
	Status    string            `json:"status"`
	Metadata  map[string]string `json:"metadata,omitempty"`
	CreatedAt time.Time         `json:"createdAt"`
	UpdatedAt time.Time         `json:"updatedAt"`
}

type InstantAnswerConfig struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Answer  string `json:"answer"`
	Mode    string `json:"mode"`
	Enabled bool   `json:"enabled"`
	Sort    int    `json:"sort"`
}

type VisitorScheme struct {
	ID                    string                `json:"id"`
	Name                  string                `json:"name"`
	Language              string                `json:"language"`
	InstantAnswersEnabled bool                  `json:"instantAnswersEnabled"`
	InstantAnswers        []InstantAnswerConfig `json:"instantAnswers"`
	IsDefault             bool                  `json:"isDefault"`
	ShopIDs               []string              `json:"shopIds"`
	CreatedAt             time.Time             `json:"createdAt"`
	UpdatedAt             time.Time             `json:"updatedAt"`
}

type Conversation struct {
	ID                    string    `json:"id"`
	ShopID                string    `json:"shopId"`
	SourceID              string    `json:"sourceId"`
	CustomerName          string    `json:"customerName,omitempty"`
	CustomerEmail         string    `json:"customerEmail,omitempty"`
	Subject               string    `json:"subject,omitempty"`
	Status                string    `json:"status"`
	AssignedAgentID       string    `json:"assignedAgentId,omitempty"`
	LastMessageAt         time.Time `json:"lastMessageAt"`
	CustomerLastMessageAt time.Time `json:"customerLastMessageAt"`
	LastMessageDirection  string    `json:"lastMessageDirection,omitempty"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
	ClosedAt              time.Time `json:"closedAt,omitempty"`
	Unread                bool      `json:"unread"`
	Kind                  string    `json:"kind"`
	ReplyAllowed          bool      `json:"replyAllowed"`
	Classification        string    `json:"classificationReason,omitempty"`
	RecordPrimary         string    `json:"recordPrimary,omitempty"`
	RecordSecondary       string    `json:"recordSecondary,omitempty"`
	RecordTertiary        string    `json:"recordTertiary,omitempty"`
	RecordRemark          string    `json:"recordRemark,omitempty"`
	RecordOrderNumber     string    `json:"recordOrderNumber,omitempty"`
	RecordClassified      bool      `json:"recordClassified"`
	RecordAutoFilled      bool      `json:"recordAutoFilled"`
	RecordUpdatedAt       time.Time `json:"recordUpdatedAt,omitempty"`
	RecordUpdatedBy       string    `json:"recordUpdatedBy,omitempty"`
	RecordRemarkError     string    `json:"recordRemarkError,omitempty"`
	RoutingReason         string    `json:"routingReason,omitempty"`
}

type ConversationUpdate struct {
	Status                   string
	AssignedAgentID          string
	SetAssignedAgentID       bool
	SetCustomerIdentity      bool
	CustomerName             string
	CustomerEmail            string
	SetEmailDisposition      bool
	Kind                     string
	ReplyAllowed             bool
	Classification           string
	SetRecord                bool
	OnlyIfRecordUnclassified bool
	OnlyIfRecordAutoFilled   bool
	RecordPrimary            string
	RecordSecondary          string
	RecordTertiary           string
	RecordRemark             string
	RecordOrderNumber        string
	RecordClassified         bool
	RecordAutoFilled         bool
	RecordUpdatedBy          string
}

type EmailProcessingTag struct {
	Label string `json:"label"`
	Color string `json:"color"`
}

type Message struct {
	ID              string            `json:"id"`
	ConversationID  string            `json:"conversationId"`
	Direction       string            `json:"direction"`
	Type            string            `json:"type"`
	Body            string            `json:"body"`
	Metadata        map[string]string `json:"metadata,omitempty"`
	SenderName      string            `json:"senderName,omitempty"`
	SenderEmail     string            `json:"senderEmail,omitempty"`
	SourceMessageID string            `json:"sourceMessageId,omitempty"`
	CreatedAt       time.Time         `json:"createdAt"`
}

type ResponseSample struct {
	AgentID        string
	ConversationID string
	Seconds        float64
	First          bool
	StartedAt      time.Time
	EndedAt        time.Time
}

type KnowledgeEntry struct {
	ID             string    `json:"id"`
	SupersedesID   string    `json:"supersedesId,omitempty"`
	Scope          string    `json:"scope"`
	ShopID         string    `json:"shopId,omitempty"`
	Title          string    `json:"title"`
	Answer         string    `json:"answer"`
	Tags           []string  `json:"tags"`
	Status         string    `json:"status"`
	ConversationID string    `json:"conversationId,omitempty"`
	SubmittedBy    string    `json:"submittedBy,omitempty"`
	ReviewedBy     string    `json:"reviewedBy,omitempty"`
	ReviewNote     string    `json:"reviewNote,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	ReviewedAt     time.Time `json:"reviewedAt,omitempty"`
}

type KnowledgeFilter struct {
	ShopID      string
	Status      string
	Scope       string
	SubmittedBy string
	Page        int
	PageSize    int
}

type KnowledgeUpdate struct {
	Scope      string
	ShopID     string
	Title      string
	Answer     string
	Tags       []string
	Status     string
	ReviewNote string
	ReviewedBy string
}

type User struct {
	ID                    string            `json:"id"`
	Email                 string            `json:"email"`
	DisplayName           string            `json:"displayName"`
	Role                  string            `json:"role"`
	Status                string            `json:"status"`
	Department            string            `json:"department"`
	SkillGroup            string            `json:"skillGroup"`
	ReceptionLimit        int               `json:"receptionLimit"`
	ReceptionOnline       bool              `json:"receptionOnline"`
	Permissions           []string          `json:"permissions"`
	PermissionsCustomized bool              `json:"permissionsCustomized"`
	ShopScope             string            `json:"shopScope"`
	ShopScopeIDs          []string          `json:"shopScopeIds"`
	DataScopes            map[string]string `json:"dataScopes"`
	WorkbenchShopScope    string            `json:"workbenchShopScope"`
	ConversationScope     string            `json:"conversationScope"`
	SystemAdmin           bool              `json:"systemAdmin"`
	PasswordHash          string            `json:"-"`
	IdentityRevision      int64             `json:"-"`
	SetAccessControl      bool              `json:"-"`
	SetShopScope          bool              `json:"-"`
	SetDepartment         bool              `json:"-"`
	SetSkillGroup         bool              `json:"-"`
	CreatedAt             time.Time         `json:"createdAt"`
	UpdatedAt             time.Time         `json:"updatedAt"`
}

type AccountAuditLog struct {
	ID           string         `json:"id"`
	ActorUserID  string         `json:"actorUserId"`
	TargetUserID string         `json:"targetUserId"`
	Action       string         `json:"action"`
	Changes      map[string]any `json:"changes"`
	CreatedAt    time.Time      `json:"createdAt"`
}

type Session struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	TokenHash string    `json:"-"`
	ExpiresAt time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
}

type ShopAgent struct {
	ShopID    string    `json:"shopId"`
	UserID    string    `json:"userId"`
	CreatedAt time.Time `json:"createdAt"`
}

type ShopifyInstallation struct {
	ShopID      string    `json:"shopId"`
	ShopDomain  string    `json:"shopDomain"`
	AccessToken string    `json:"-"`
	Scope       string    `json:"scope"`
	InstalledAt time.Time `json:"installedAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type ShopifyAppProfile struct {
	ShopID                   string    `json:"shopId"`
	ShopDomain               string    `json:"shopDomain"`
	ClientID                 string    `json:"clientId"`
	EncryptedClientSecret    string    `json:"-"`
	EncryptedAutomationToken string    `json:"-"`
	HasClientSecret          bool      `json:"hasClientSecret"`
	HasAutomationToken       bool      `json:"hasAutomationToken"`
	ExtensionHandle          string    `json:"extensionHandle"`
	DeployStatus             string    `json:"deployStatus"`
	DeployVersion            string    `json:"deployVersion,omitempty"`
	DeployMessage            string    `json:"deployMessage,omitempty"`
	DeployedAt               time.Time `json:"deployedAt,omitempty"`
	CreatedAt                time.Time `json:"createdAt"`
	UpdatedAt                time.Time `json:"updatedAt"`
}

type EmailInstallation struct {
	ShopID       string    `json:"shopId"`
	Mailbox      string    `json:"mailbox"`
	Provider     string    `json:"provider"`
	AccessToken  string    `json:"-"`
	RefreshToken string    `json:"-"`
	Scope        string    `json:"scope"`
	ExpiresAt    time.Time `json:"expiresAt"`
	InstalledAt  time.Time `json:"installedAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type EmailHistoryImportJob struct {
	ID                   string    `json:"id"`
	ShopID               string    `json:"shopId"`
	SourceID             string    `json:"sourceId"`
	Provider             string    `json:"provider"`
	Mailbox              string    `json:"mailbox"`
	Status               string    `json:"status"`
	Cursor               string    `json:"-"`
	PagesProcessed       int       `json:"pagesProcessed"`
	MessagesScanned      int       `json:"messagesScanned"`
	MessagesImported     int       `json:"messagesImported"`
	MessagesSkipped      int       `json:"messagesSkipped"`
	FilteredMessages     int       `json:"filteredMessages"`
	ConversationsCreated int       `json:"conversationsCreated"`
	LastError            string    `json:"lastError,omitempty"`
	StartedAt            time.Time `json:"startedAt,omitempty"`
	CompletedAt          time.Time `json:"completedAt,omitempty"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type EmailSyncJob struct {
	ID             string    `json:"id"`
	ShopID         string    `json:"shopId"`
	SourceID       string    `json:"sourceId"`
	Provider       string    `json:"provider"`
	Priority       int       `json:"priority"`
	Reason         string    `json:"reason"`
	Status         string    `json:"status"`
	RerunRequested bool      `json:"rerunRequested"`
	AvailableAt    time.Time `json:"availableAt"`
	Attempts       int       `json:"attempts"`
	LastError      string    `json:"lastError,omitempty"`
	StartedAt      time.Time `json:"startedAt,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type EmailAttachmentJob struct {
	ID                string    `json:"id"`
	ShopID            string    `json:"shopId"`
	SourceID          string    `json:"sourceId"`
	ConversationID    string    `json:"conversationId"`
	MessageID         string    `json:"messageId"`
	Provider          string    `json:"provider"`
	ProviderMessageID string    `json:"providerMessageId"`
	Priority          int       `json:"priority"`
	Status            string    `json:"status"`
	AvailableAt       time.Time `json:"availableAt"`
	Attempts          int       `json:"attempts"`
	LastError         string    `json:"lastError,omitempty"`
	StartedAt         time.Time `json:"startedAt,omitempty"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type ShopifyOrderSyncJob struct {
	ID                      string    `json:"id"`
	ShopID                  string    `json:"shopId"`
	Priority                int       `json:"priority"`
	Reason                  string    `json:"reason"`
	TargetOrderID           string    `json:"targetOrderId,omitempty"`
	Status                  string    `json:"status"`
	RerunRequested          bool      `json:"rerunRequested"`
	ReconciliationRequested bool      `json:"reconciliationRequested"`
	AvailableAt             time.Time `json:"availableAt"`
	Attempts                int       `json:"attempts"`
	LastError               string    `json:"lastError,omitempty"`
	StartedAt               time.Time `json:"startedAt,omitempty"`
	CreatedAt               time.Time `json:"createdAt"`
	UpdatedAt               time.Time `json:"updatedAt"`
}

type EmailQuarantineRecord struct {
	ID              string    `json:"id"`
	ShopID          string    `json:"shopId"`
	SourceID        string    `json:"sourceId"`
	Provider        string    `json:"provider"`
	SourceMessageID string    `json:"sourceMessageId"`
	Stage           string    `json:"stage"`
	ErrorMessage    string    `json:"errorMessage"`
	Payload         string    `json:"-"`
	Status          string    `json:"status"`
	Attempts        int       `json:"attempts"`
	FirstFailedAt   time.Time `json:"firstFailedAt"`
	LastFailedAt    time.Time `json:"lastFailedAt"`
	ResolvedAt      time.Time `json:"resolvedAt,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type EmailOutboxRecord struct {
	ID               string    `json:"id"`
	ShopID           string    `json:"shopId"`
	SourceID         string    `json:"sourceId"`
	ConversationID   string    `json:"conversationId"`
	ClientRequestID  string    `json:"clientRequestId"`
	RequestedBy      string    `json:"requestedBy"`
	Body             string    `json:"-"`
	RequestMetadata  string    `json:"-"`
	ProviderMetadata string    `json:"-"`
	Status           string    `json:"status"`
	Attempts         int       `json:"attempts"`
	LastError        string    `json:"lastError,omitempty"`
	MessageID        string    `json:"messageId,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
	CompletedAt      time.Time `json:"completedAt,omitempty"`
}

type EmailExportJob struct {
	ID                  string    `json:"id"`
	RequestedBy         string    `json:"requestedBy"`
	Filter              string    `json:"-"`
	Status              string    `json:"status"`
	Filename            string    `json:"filename,omitempty"`
	FilePath            string    `json:"-"`
	RowCount            int       `json:"rowCount"`
	ProgressStage       string    `json:"progressStage,omitempty"`
	AttachmentTotal     int       `json:"attachmentTotal"`
	AttachmentProcessed int       `json:"attachmentProcessed"`
	AttachmentSucceeded int       `json:"attachmentSucceeded"`
	AttachmentFailed    int       `json:"attachmentFailed"`
	LastError           string    `json:"lastError,omitempty"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
	StartedAt           time.Time `json:"startedAt,omitempty"`
	CompletedAt         time.Time `json:"completedAt,omitempty"`
	ExpiresAt           time.Time `json:"expiresAt"`
}

type EmailRuntimeEvent struct {
	ID        string    `json:"id"`
	Category  string    `json:"category"`
	Severity  string    `json:"severity"`
	ShopID    string    `json:"shopId,omitempty"`
	SourceID  string    `json:"sourceId,omitempty"`
	EntityID  string    `json:"entityId,omitempty"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"createdAt"`
}

type AuthResult struct {
	Token           string    `json:"token"`
	ExpiresAt       time.Time `json:"expiresAt"`
	User            User      `json:"user"`
	TenantID        string    `json:"tenantId,omitempty"`
	IntegrationMode string    `json:"integrationMode,omitempty"`
}

type Event struct {
	Type         string        `json:"type"`
	ShopID       string        `json:"shopId,omitempty"`
	EntityID     string        `json:"entityId,omitempty"`
	Payload      any           `json:"payload,omitempty"`
	Conversation *Conversation `json:"conversation,omitempty"`
	CreatedAt    time.Time     `json:"createdAt"`
}

type TransferRequest struct {
	ID               string    `json:"id"`
	ConversationID   string    `json:"conversationId"`
	ShopID           string    `json:"shopId"`
	FromAgentID      string    `json:"fromAgentId"`
	TargetAgentID    string    `json:"targetAgentId,omitempty"`
	TargetSkillGroup string    `json:"targetSkillGroup,omitempty"`
	Status           string    `json:"status"`
	Note             string    `json:"note,omitempty"`
	ResolvedBy       string    `json:"resolvedBy,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type TransferCandidate struct {
	Agent               User   `json:"agent"`
	SkillGroup          string `json:"skillGroup"`
	ActiveConversations int    `json:"activeConversations"`
	Capacity            int    `json:"capacity"`
	Presence            string `json:"presence"`
	RequiresAcceptance  bool   `json:"requiresAcceptance"`
}

type TicketAttachment struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type Ticket struct {
	ID                 string             `json:"id"`
	Type               string             `json:"type"`
	ParentTicketID     string             `json:"parentTicketId,omitempty"`
	ConversationID     string             `json:"conversationId,omitempty"`
	ShopID             string             `json:"shopId,omitempty"`
	CustomerRef        string             `json:"customerRef,omitempty"`
	CustomerName       string             `json:"customerName,omitempty"`
	CustomerEmail      string             `json:"customerEmail,omitempty"`
	OrderNumber        string             `json:"orderNumber,omitempty"`
	Title              string             `json:"title"`
	Category           string             `json:"category"`
	Priority           string             `json:"priority"`
	Status             string             `json:"status"`
	AssignedGroup      string             `json:"assignedGroup,omitempty"`
	AssignedAgentID    string             `json:"assignedAgentId,omitempty"`
	HandoffFromAgentID string             `json:"handoffFromAgentId,omitempty"`
	CollaboratorIDs    []string           `json:"collaboratorIds"`
	Description        string             `json:"description"`
	Attachments        []TicketAttachment `json:"attachments"`
	DueAt              *time.Time         `json:"dueAt,omitempty"`
	WaitingReason      string             `json:"waitingReason,omitempty"`
	RequiresAcceptance bool               `json:"requiresAcceptance"`
	AcceptedAt         *time.Time         `json:"acceptedAt,omitempty"`
	CompletedBy        string             `json:"completedBy,omitempty"`
	CompletedAt        *time.Time         `json:"completedAt,omitempty"`
	CancelledAt        *time.Time         `json:"cancelledAt,omitempty"`
	CreatedBy          string             `json:"createdBy"`
	CreatedAt          time.Time          `json:"createdAt"`
	UpdatedAt          time.Time          `json:"updatedAt"`
}

type TicketCustomer struct {
	CustomerRef    string    `json:"customerRef"`
	ShopID         string    `json:"shopId"`
	CustomerName   string    `json:"customerName,omitempty"`
	CustomerEmail  string    `json:"customerEmail,omitempty"`
	ConversationID string    `json:"conversationId"`
	LastMessageAt  time.Time `json:"lastMessageAt"`
}

type TicketFilter struct {
	Type            string
	ShopID          string
	ConversationID  string
	AssignedAgentID string
	ParticipantID   string
	Status          string
	Priority        string
	Search          string
	View            string
	ViewerID        string
	Page            int
	PageSize        int
}

type TicketSummary struct {
	Total         int `json:"total"`
	Customer      int `json:"customer"`
	Internal      int `json:"internal"`
	Open          int `json:"open"`
	InProgress    int `json:"inProgress"`
	PendingReview int `json:"pendingReview"`
	Overdue       int `json:"overdue"`
	Mine          int `json:"mine"`
	WaitingForMe  int `json:"waitingForMe"`
	ReviewForMe   int `json:"reviewForMe"`
	CreatedByMe   int `json:"createdByMe"`
	Active        int `json:"active"`
	Completed     int `json:"completed"`
}

type TicketUpdate struct {
	Type               string
	SetType            bool
	ParentTicketID     string
	SetParentTicketID  bool
	ConversationID     string
	SetConversationID  bool
	Title              string
	Category           string
	Priority           string
	Status             string
	AssignedGroup      string
	AssignedAgentID    string
	Description        string
	SetAssignedAgentID bool
	HandoffFromAgentID string
	SetHandoffFromID   bool
	CollaboratorIDs    []string
	SetCollaboratorIDs bool
	DueAt              *time.Time
	SetDueAt           bool
	WaitingReason      string
	SetWaitingReason   bool
	RequiresAcceptance *bool
	AcceptedAt         *time.Time
	SetAcceptedAt      bool
	CompletedBy        string
	SetCompletedBy     bool
	CompletedAt        *time.Time
	SetCompletedAt     bool
	CancelledAt        *time.Time
	SetCancelledAt     bool
}

type TicketComment struct {
	ID        string    `json:"id"`
	TicketID  string    `json:"ticketId"`
	AuthorID  string    `json:"authorId"`
	Kind      string    `json:"kind"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}

type TicketContext struct {
	Conversation Conversation `json:"conversation"`
	Messages     []Message    `json:"messages"`
	HasMore      bool         `json:"hasMore"`
}

const (
	ShopStatusActive   = "active"
	ShopStatusDisabled = "disabled"

	SourceTypeShopifyChat  = "shopify_chat"
	SourceTypeShopifyInbox = "shopify_inbox"
	SourceTypeShopifyAPI   = "shopify_api"
	SourceTypeEmail        = "email"

	SourceStatusActive   = "active"
	SourceStatusDisabled = "disabled"

	ShopifyAppDeployPending = "pending"
	ShopifyAppDeployRunning = "running"
	ShopifyAppDeployReady   = "ready"
	ShopifyAppDeployFailed  = "failed"

	ConversationStatusOpen     = "open"
	ConversationStatusAssigned = "assigned"
	ConversationStatusClosed   = "closed"

	ConversationKindCustomer   = "customer"
	ConversationKindSystem     = "system"
	ConversationKindDepartment = "department"

	MessageDirectionCustomer = "customer"
	MessageDirectionAgent    = "agent"
	MessageDirectionSystem   = "system"

	MessageTypeText    = "text"
	MessageTypeImage   = "image"
	MessageTypeFile    = "file"
	MessageTypeProduct = "product"

	TransferStatusPending   = "pending"
	TransferStatusCompleted = "completed"
	TransferStatusAccepted  = "accepted"
	TransferStatusRejected  = "rejected"
	TransferStatusCancelled = "cancelled"

	TicketStatusOpen          = "open"
	TicketStatusInProgress    = "in_progress"
	TicketStatusPending       = "pending"
	TicketStatusPendingReview = "pending_review"
	TicketStatusResolved      = "resolved"
	TicketStatusClosed        = "closed"
	TicketStatusCancelled     = "cancelled"

	TicketTypeCustomer = "customer"
	TicketTypeInternal = "internal"

	TicketCommentKindComment = "comment"
	TicketCommentKindSystem  = "system"

	KnowledgeScopeGlobal = "global"
	KnowledgeScopeShop   = "shop"

	KnowledgeStatusPending   = "pending"
	KnowledgeStatusPublished = "published"
	KnowledgeStatusRejected  = "rejected"

	UserRoleAdmin = "admin"
	UserRoleAgent = "agent"

	UserStatusActive   = "active"
	UserStatusDisabled = "disabled"

	DepartmentCustomerService = "客服部"
	DepartmentFinance         = "财务部"
	DepartmentGeneral         = "综合部"

	SkillGroupConsulting = "咨询接待"
	SkillGroupAfterSales = "售后"
)

const messageAgentIDMetadataKey = "agentId"
