package platform

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestKnowledgePermissionsAndPublishedRevisionWorkflow(t *testing.T) {
	store := NewMemoryStore()
	platformServer := NewServer(store)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{
		DisplayName: "Knowledge Permission Shop",
	}, http.StatusCreated, &shop)

	editorToken := createKnowledgeTestUser(t, server.URL, adminToken, createUserRequest{
		Email:                 "knowledge-editor@example.com",
		DisplayName:           "Knowledge Editor",
		Password:              "editor-password",
		Role:                  UserRoleAgent,
		Permissions:           []string{PermissionKnowledgeCreate, PermissionKnowledgeEdit},
		PermissionsCustomized: true,
		DataScopes:            map[string]string{DataScopeKnowledge: AccessScopeAll},
	})
	reviewerToken := createKnowledgeTestUser(t, server.URL, adminToken, createUserRequest{
		Email:                 "knowledge-reviewer@example.com",
		DisplayName:           "Knowledge Reviewer",
		Password:              "reviewer-password",
		Role:                  UserRoleAgent,
		Permissions:           []string{PermissionKnowledgeReview},
		PermissionsCustomized: true,
		DataScopes:            map[string]string{DataScopeKnowledge: AccessScopeAll},
	})
	viewerToken := createKnowledgeTestUser(t, server.URL, adminToken, createUserRequest{
		Email:                 "knowledge-viewer@example.com",
		DisplayName:           "Knowledge Viewer",
		Password:              "viewer-password",
		Role:                  UserRoleAgent,
		PermissionsCustomized: true,
		DataScopes:            map[string]string{DataScopeKnowledge: AccessScopeAll},
	})

	var published KnowledgeEntry
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/knowledge", adminToken, createKnowledgeRequest{
		Scope: KnowledgeScopeShop, ShopID: shop.ID, Title: "Original title", Answer: "Original approved answer",
	}, http.StatusCreated, &published)
	if published.Status != KnowledgeStatusPublished {
		t.Fatalf("reviewer-created knowledge should publish immediately: %#v", published)
	}

	var viewerPage knowledgePageResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/knowledge?status=published", viewerToken, nil, http.StatusOK, &viewerPage)
	if len(viewerPage.Items) != 1 || viewerPage.Items[0].ID != published.ID {
		t.Fatalf("all authenticated users should see published knowledge: %#v", viewerPage)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/knowledge", viewerToken, createKnowledgeRequest{
		Scope: KnowledgeScopeShop, ShopID: shop.ID, Title: "Forbidden", Answer: "Forbidden",
	}, http.StatusForbidden, nil)
	requestJSON(t, http.MethodDelete, server.URL+"/api/v1/knowledge/"+published.ID, viewerToken, nil, http.StatusForbidden, nil)
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/knowledge/"+published.ID, reviewerToken, updateKnowledgeRequest{
		Answer: "Review permission must not imply edit permission",
	}, http.StatusForbidden, nil)

	var revision KnowledgeEntry
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/knowledge/"+published.ID, editorToken, updateKnowledgeRequest{
		Title: "Revised title", Answer: "Revised answer",
	}, http.StatusOK, &revision)
	if revision.Status != KnowledgeStatusPending || revision.SupersedesID != published.ID || revision.ID == published.ID {
		t.Fatalf("editing published knowledge without review permission must create a revision: %#v", revision)
	}
	stillPublished, err := store.GetKnowledge(t.Context(), published.ID)
	if err != nil || stillPublished.Answer != "Original approved answer" || stillPublished.Status != KnowledgeStatusPublished {
		t.Fatalf("published version changed before review: entry=%#v err=%v", stillPublished, err)
	}
	relevant, err := platformServer.relevantKnowledge(t.Context(), shop.ID, []Message{{Body: "Original title"}})
	if err != nil || len(relevant) != 1 || relevant[0].Answer != "Original approved answer" {
		t.Fatalf("AI should continue using the published version before approval: entries=%#v err=%v", relevant, err)
	}

	var approved KnowledgeEntry
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/knowledge/"+revision.ID, reviewerToken, updateKnowledgeRequest{
		Status: KnowledgeStatusPublished,
	}, http.StatusOK, &approved)
	if approved.ID != published.ID || approved.Answer != "Revised answer" || approved.Status != KnowledgeStatusPublished {
		t.Fatalf("approved revision did not replace the published version: %#v", approved)
	}
	if _, err := store.GetKnowledge(t.Context(), revision.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("applied revision should be removed, got %v", err)
	}

	var directEdit KnowledgeEntry
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/knowledge/"+published.ID, adminToken, updateKnowledgeRequest{
		Answer: "Directly published reviewer edit",
	}, http.StatusOK, &directEdit)
	if directEdit.ID != published.ID || directEdit.Status != KnowledgeStatusPublished || directEdit.Answer != "Directly published reviewer edit" {
		t.Fatalf("editor with review permission should publish directly: %#v", directEdit)
	}
}

func TestConversationKnowledgeSubmissionIsUniversalAndReviewAware(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Submission Shop"}, http.StatusCreated, &shop)
	var submitter User
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/users", adminToken, createUserRequest{
		Email:                 "knowledge-submitter@example.com",
		DisplayName:           "Knowledge Submitter",
		Password:              "submitter-password",
		Role:                  UserRoleAgent,
		Permissions:           []string{PermissionWorkbenchAccess},
		PermissionsCustomized: true,
		ShopScope:             AccessScopeAll,
		ConversationScope:     AccessScopeAssigned,
	}, http.StatusCreated, &submitter)
	var login AuthResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/auth/login", "", loginRequest{
		Email: "knowledge-submitter@example.com", Password: "submitter-password",
	}, http.StatusOK, &login)
	if _, err := store.AssignUserToShop(t.Context(), shop.ID, submitter.ID); err != nil {
		t.Fatalf("assign submitter to shop failed: %v", err)
	}

	source, err := store.CreateShopSource(t.Context(), ShopSource{ShopID: shop.ID, Type: SourceTypeShopifyChat})
	if err != nil {
		t.Fatalf("create source failed: %v", err)
	}
	conversation, err := store.CreateConversation(t.Context(), Conversation{
		ShopID: shop.ID, SourceID: source.ID, Status: ConversationStatusOpen, AssignedAgentID: submitter.ID,
	})
	if err != nil {
		t.Fatalf("create conversation failed: %v", err)
	}
	var entry KnowledgeEntry
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/knowledge", login.Token, submitConversationKnowledgeRequest{
		Title: "Customer question", Answer: "Reusable answer",
	}, http.StatusCreated, &entry)
	if entry.Status != KnowledgeStatusPending || entry.SubmittedBy != submitter.ID {
		t.Fatalf("unprivileged conversation submission should enter review: %#v", entry)
	}
}

func TestLegacyKnowledgePermissionsExpandToGranularPermissions(t *testing.T) {
	for _, role := range []string{UserRoleAdmin, UserRoleAgent} {
		defaults := defaultPermissionsForRole(role)
		for _, permission := range []string{
			PermissionKnowledgeCreate,
			PermissionKnowledgeEdit,
			PermissionKnowledgeDelete,
			PermissionKnowledgeReview,
		} {
			if containsPermission(defaults, permission) {
				t.Fatalf("%s knowledge action permission should default off: %s", role, permission)
			}
		}
	}
	user := User{
		PermissionsCustomized: true,
		Permissions:           []string{PermissionKnowledgeManage, PermissionKnowledgeImport},
	}
	for _, permission := range []string{
		PermissionKnowledgeCreate,
		PermissionKnowledgeEdit,
		PermissionKnowledgeDelete,
		PermissionKnowledgeReview,
	} {
		if !userHasPermission(user, permission) {
			t.Fatalf("legacy permissions should include %s", permission)
		}
	}
}

func createKnowledgeTestUser(t *testing.T, serverURL string, adminToken string, input createUserRequest) string {
	t.Helper()
	var user User
	requestJSON(t, http.MethodPost, serverURL+"/api/v1/users", adminToken, input, http.StatusCreated, &user)
	var login AuthResult
	requestJSON(t, http.MethodPost, serverURL+"/api/v1/auth/login", "", loginRequest{
		Email: input.Email, Password: input.Password,
	}, http.StatusOK, &login)
	return login.Token
}
