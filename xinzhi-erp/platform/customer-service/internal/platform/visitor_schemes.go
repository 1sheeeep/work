package platform

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	visitorLanguageAuto      = "auto"
	visitorLanguageEnglish   = "en"
	instantAnswerModeText    = "text"
	instantAnswerModeOrder   = "order_tracking"
	visitorSchemeNameMaxSize = 80
)

func defaultVisitorScheme() VisitorScheme {
	var answers []InstantAnswerConfig
	_ = json.Unmarshal([]byte(defaultShopifyChatInstantAnswersJSON), &answers)
	now := time.Now().UTC()
	return VisitorScheme{
		ID:                    defaultVisitorSchemeID,
		Name:                  defaultVisitorSchemeName,
		Language:              visitorLanguageAuto,
		InstantAnswersEnabled: true,
		InstantAnswers:        answers,
		IsDefault:             true,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
}

func normalizeVisitorScheme(input VisitorScheme, creating bool) (VisitorScheme, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return VisitorScheme{}, fmt.Errorf("%w: scheme name is required", ErrInvalid)
	}
	if len([]rune(input.Name)) > visitorSchemeNameMaxSize {
		return VisitorScheme{}, fmt.Errorf("%w: scheme name is too long", ErrInvalid)
	}
	input.Language = strings.ToLower(strings.TrimSpace(input.Language))
	if input.Language == "" {
		input.Language = visitorLanguageAuto
	}
	if input.Language != visitorLanguageAuto && input.Language != visitorLanguageEnglish {
		return VisitorScheme{}, fmt.Errorf("%w: unsupported visitor language", ErrInvalid)
	}
	seen := map[string]bool{}
	answers := make([]InstantAnswerConfig, 0, len(input.InstantAnswers))
	for index, answer := range input.InstantAnswers {
		answer.ID = strings.TrimSpace(answer.ID)
		if answer.ID == "" {
			answer.ID = fmt.Sprintf("answer_%d", index+1)
		}
		if seen[answer.ID] {
			return VisitorScheme{}, fmt.Errorf("%w: duplicate instant answer id", ErrInvalid)
		}
		seen[answer.ID] = true
		answer.Title = strings.TrimSpace(answer.Title)
		answer.Answer = strings.TrimSpace(answer.Answer)
		answer.Mode = strings.ToLower(strings.TrimSpace(answer.Mode))
		if answer.Mode == "" {
			answer.Mode = instantAnswerModeText
		}
		if answer.Mode != instantAnswerModeText && answer.Mode != instantAnswerModeOrder {
			return VisitorScheme{}, fmt.Errorf("%w: unsupported instant answer mode", ErrInvalid)
		}
		if answer.Title == "" || answer.Answer == "" {
			return VisitorScheme{}, fmt.Errorf("%w: instant answer title and content are required", ErrInvalid)
		}
		answer.Sort = index
		answers = append(answers, answer)
	}
	input.InstantAnswers = answers
	input.ShopIDs = normalizeStringIDs(input.ShopIDs)
	if creating && strings.TrimSpace(input.ID) == "" {
		input.ID = prefixedID("visitor_scheme")
	}
	return input, nil
}

func normalizeStringIDs(input []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(input))
	for _, value := range input {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func cloneVisitorScheme(input VisitorScheme) VisitorScheme {
	input.InstantAnswers = append([]InstantAnswerConfig{}, input.InstantAnswers...)
	input.ShopIDs = append([]string{}, input.ShopIDs...)
	return input
}

func visitorSchemeMetadata(current map[string]string, scheme VisitorScheme) map[string]string {
	metadata := cloneStringMap(current)
	if metadata == nil {
		metadata = map[string]string{}
	}
	answers, _ := json.Marshal(scheme.InstantAnswers)
	metadata["visitorSchemeId"] = scheme.ID
	metadata["visitorSchemeName"] = scheme.Name
	metadata["visitorLanguage"] = scheme.Language
	metadata["instantAnswersEnabled"] = fmt.Sprintf("%t", scheme.InstantAnswersEnabled)
	metadata["instantAnswersVersion"] = shopifyChatInstantAnswersVersion
	metadata["instantAnswersJson"] = string(answers)
	return metadata
}

func (s *MemoryStore) ListVisitorSchemes(ctx context.Context) ([]VisitorScheme, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]VisitorScheme, 0, len(s.visitorSchemes))
	for _, scheme := range s.visitorSchemes {
		scheme.ShopIDs = []string{}
		for shopID, schemeID := range s.visitorSchemeShops {
			if schemeID == scheme.ID {
				scheme.ShopIDs = append(scheme.ShopIDs, shopID)
			}
		}
		sort.Strings(scheme.ShopIDs)
		out = append(out, cloneVisitorScheme(scheme))
	}
	sortVisitorSchemes(out)
	return out, nil
}

func sortVisitorSchemes(items []VisitorScheme) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDefault != items[j].IsDefault {
			return items[i].IsDefault
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
}

func (s *MemoryStore) GetVisitorScheme(ctx context.Context, id string) (VisitorScheme, error) {
	items, err := s.ListVisitorSchemes(ctx)
	if err != nil {
		return VisitorScheme{}, err
	}
	for _, item := range items {
		if item.ID == strings.TrimSpace(id) {
			return item, nil
		}
	}
	return VisitorScheme{}, ErrNotFound
}

func (s *MemoryStore) CreateVisitorScheme(ctx context.Context, input VisitorScheme) (VisitorScheme, error) {
	if err := ctx.Err(); err != nil {
		return VisitorScheme{}, err
	}
	input, err := normalizeVisitorScheme(input, true)
	if err != nil {
		return VisitorScheme{}, err
	}
	now := time.Now().UTC()
	input.IsDefault = false
	input.ShopIDs = nil
	input.CreatedAt = now
	input.UpdatedAt = now
	s.mu.Lock()
	for _, current := range s.visitorSchemes {
		if strings.EqualFold(current.Name, input.Name) {
			s.mu.Unlock()
			return VisitorScheme{}, fmt.Errorf("%w: scheme name already exists", ErrConflict)
		}
	}
	s.visitorSchemes[input.ID] = cloneVisitorScheme(input)
	s.mu.Unlock()
	return cloneVisitorScheme(input), nil
}

func (s *MemoryStore) UpdateVisitorScheme(ctx context.Context, id string, input VisitorScheme) (VisitorScheme, error) {
	if err := ctx.Err(); err != nil {
		return VisitorScheme{}, err
	}
	input, err := normalizeVisitorScheme(input, false)
	if err != nil {
		return VisitorScheme{}, err
	}
	id = strings.TrimSpace(id)
	s.mu.Lock()
	current, ok := s.visitorSchemes[id]
	if !ok {
		s.mu.Unlock()
		return VisitorScheme{}, ErrNotFound
	}
	if current.IsDefault {
		input.Name = current.Name
	}
	for currentID, other := range s.visitorSchemes {
		if currentID != id && strings.EqualFold(other.Name, input.Name) {
			s.mu.Unlock()
			return VisitorScheme{}, fmt.Errorf("%w: scheme name already exists", ErrConflict)
		}
	}
	current.Name = input.Name
	current.Language = input.Language
	current.InstantAnswersEnabled = input.InstantAnswersEnabled
	current.InstantAnswers = append([]InstantAnswerConfig(nil), input.InstantAnswers...)
	current.UpdatedAt = time.Now().UTC()
	s.visitorSchemes[id] = current
	s.mu.Unlock()
	return s.GetVisitorScheme(ctx, id)
}

func (s *MemoryStore) ApplyVisitorScheme(ctx context.Context, id string, shopIDs []string) (VisitorScheme, error) {
	if err := ctx.Err(); err != nil {
		return VisitorScheme{}, err
	}
	id = strings.TrimSpace(id)
	shopIDs = normalizeStringIDs(shopIDs)
	s.mu.Lock()
	scheme, ok := s.visitorSchemes[id]
	if !ok {
		s.mu.Unlock()
		return VisitorScheme{}, ErrNotFound
	}
	targets := map[string]bool{}
	for _, shopID := range shopIDs {
		if _, ok := s.shops[shopID]; !ok || !s.memoryShopHasChatSourceLocked(shopID) {
			s.mu.Unlock()
			return VisitorScheme{}, fmt.Errorf("%w: selected shop has no Xzdesk Chat source", ErrInvalid)
		}
		targets[shopID] = true
	}
	defaultScheme := s.visitorSchemes[defaultVisitorSchemeID]
	if !scheme.IsDefault {
		for shopID, assignedID := range s.visitorSchemeShops {
			if assignedID == id && !targets[shopID] {
				s.visitorSchemeShops[shopID] = defaultVisitorSchemeID
				s.applyVisitorSchemeSnapshotLocked(shopID, defaultScheme)
			}
		}
	}
	for _, shopID := range shopIDs {
		s.visitorSchemeShops[shopID] = id
		s.applyVisitorSchemeSnapshotLocked(shopID, scheme)
	}
	s.mu.Unlock()
	return s.GetVisitorScheme(ctx, id)
}

func (s *MemoryStore) memoryShopHasChatSourceLocked(shopID string) bool {
	for _, source := range s.sources {
		if source.ShopID == shopID && source.Type == SourceTypeShopifyChat {
			return true
		}
	}
	return false
}

func (s *MemoryStore) applyVisitorSchemeSnapshotLocked(shopID string, scheme VisitorScheme) {
	for sourceID, source := range s.sources {
		if source.ShopID != shopID || source.Type != SourceTypeShopifyChat {
			continue
		}
		source.Metadata = visitorSchemeMetadata(source.Metadata, scheme)
		source.UpdatedAt = time.Now().UTC()
		s.sources[sourceID] = source
	}
}

func (s *MemoryStore) DeleteVisitorScheme(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	s.mu.Lock()
	scheme, ok := s.visitorSchemes[id]
	if !ok {
		s.mu.Unlock()
		return ErrNotFound
	}
	if scheme.IsDefault {
		s.mu.Unlock()
		return fmt.Errorf("%w: default scheme cannot be deleted", ErrInvalid)
	}
	defaultScheme := s.visitorSchemes[defaultVisitorSchemeID]
	for shopID, assignedID := range s.visitorSchemeShops {
		if assignedID == id {
			s.visitorSchemeShops[shopID] = defaultVisitorSchemeID
			s.applyVisitorSchemeSnapshotLocked(shopID, defaultScheme)
		}
	}
	delete(s.visitorSchemes, id)
	s.mu.Unlock()
	return nil
}

func (s *PostgresStore) ListVisitorSchemes(ctx context.Context) ([]VisitorScheme, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT vs.id, vs.name, vs.language, vs.instant_answers_enabled, vs.instant_answers,
		       vs.is_default, vs.created_at, vs.updated_at,
		       COALESCE((SELECT jsonb_agg(vsa.shop_id ORDER BY vsa.shop_id) FROM visitor_scheme_assignments vsa WHERE vsa.scheme_id = vs.id), '[]'::jsonb)
		FROM visitor_schemes vs
		ORDER BY vs.is_default DESC, LOWER(vs.name), vs.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VisitorScheme{}
	for rows.Next() {
		scheme, err := scanVisitorScheme(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, scheme)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetVisitorScheme(ctx context.Context, id string) (VisitorScheme, error) {
	scheme, err := scanVisitorScheme(s.db.QueryRowContext(ctx, `
		SELECT vs.id, vs.name, vs.language, vs.instant_answers_enabled, vs.instant_answers,
		       vs.is_default, vs.created_at, vs.updated_at,
		       COALESCE((SELECT jsonb_agg(vsa.shop_id ORDER BY vsa.shop_id) FROM visitor_scheme_assignments vsa WHERE vsa.scheme_id = vs.id), '[]'::jsonb)
		FROM visitor_schemes vs WHERE vs.id = $1
	`, strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return VisitorScheme{}, ErrNotFound
	}
	return scheme, err
}

func scanVisitorScheme(row scanner) (VisitorScheme, error) {
	var scheme VisitorScheme
	var answersRaw, shopIDsRaw []byte
	err := row.Scan(&scheme.ID, &scheme.Name, &scheme.Language, &scheme.InstantAnswersEnabled, &answersRaw,
		&scheme.IsDefault, &scheme.CreatedAt, &scheme.UpdatedAt, &shopIDsRaw)
	if err != nil {
		return VisitorScheme{}, err
	}
	if err := json.Unmarshal(answersRaw, &scheme.InstantAnswers); err != nil {
		return VisitorScheme{}, err
	}
	if err := json.Unmarshal(shopIDsRaw, &scheme.ShopIDs); err != nil {
		return VisitorScheme{}, err
	}
	return scheme, nil
}

func (s *PostgresStore) CreateVisitorScheme(ctx context.Context, input VisitorScheme) (VisitorScheme, error) {
	input, err := normalizeVisitorScheme(input, true)
	if err != nil {
		return VisitorScheme{}, err
	}
	answers, err := json.Marshal(input.InstantAnswers)
	if err != nil {
		return VisitorScheme{}, err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO visitor_schemes (id, name, language, instant_answers_enabled, instant_answers, is_default, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, FALSE, $6, $6)
	`, input.ID, input.Name, input.Language, input.InstantAnswersEnabled, answers, now)
	if isUniqueConstraintError(err) {
		return VisitorScheme{}, fmt.Errorf("%w: scheme name already exists", ErrConflict)
	}
	if err != nil {
		return VisitorScheme{}, err
	}
	return s.GetVisitorScheme(ctx, input.ID)
}

func (s *PostgresStore) UpdateVisitorScheme(ctx context.Context, id string, input VisitorScheme) (VisitorScheme, error) {
	input, err := normalizeVisitorScheme(input, false)
	if err != nil {
		return VisitorScheme{}, err
	}
	answers, err := json.Marshal(input.InstantAnswers)
	if err != nil {
		return VisitorScheme{}, err
	}
	current, err := s.GetVisitorScheme(ctx, id)
	if err != nil {
		return VisitorScheme{}, err
	}
	if current.IsDefault {
		input.Name = current.Name
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE visitor_schemes
		SET name = $2, language = $3, instant_answers_enabled = $4, instant_answers = $5, updated_at = $6
		WHERE id = $1
	`, strings.TrimSpace(id), input.Name, input.Language, input.InstantAnswersEnabled, answers, time.Now().UTC())
	if isUniqueConstraintError(err) {
		return VisitorScheme{}, fmt.Errorf("%w: scheme name already exists", ErrConflict)
	}
	if err != nil {
		return VisitorScheme{}, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return VisitorScheme{}, ErrNotFound
	}
	return s.GetVisitorScheme(ctx, id)
}

func (s *PostgresStore) ApplyVisitorScheme(ctx context.Context, id string, shopIDs []string) (VisitorScheme, error) {
	id = strings.TrimSpace(id)
	shopIDs = normalizeStringIDs(shopIDs)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return VisitorScheme{}, err
	}
	defer tx.Rollback()
	scheme, err := scanVisitorScheme(tx.QueryRowContext(ctx, `
		SELECT vs.id, vs.name, vs.language, vs.instant_answers_enabled, vs.instant_answers,
		       vs.is_default, vs.created_at, vs.updated_at,
		       COALESCE((SELECT jsonb_agg(vsa.shop_id ORDER BY vsa.shop_id) FROM visitor_scheme_assignments vsa WHERE vsa.scheme_id = vs.id), '[]'::jsonb)
		FROM visitor_schemes vs WHERE vs.id = $1 FOR UPDATE
	`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return VisitorScheme{}, ErrNotFound
	}
	if err != nil {
		return VisitorScheme{}, err
	}
	for _, shopID := range shopIDs {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM shop_sources WHERE shop_id = $1 AND type = $2)`, shopID, SourceTypeShopifyChat).Scan(&exists); err != nil {
			return VisitorScheme{}, err
		}
		if !exists {
			return VisitorScheme{}, fmt.Errorf("%w: selected shop has no Xzdesk Chat source", ErrInvalid)
		}
	}
	targets := map[string]bool{}
	for _, shopID := range shopIDs {
		targets[shopID] = true
	}
	removed := []string{}
	if !scheme.IsDefault {
		for _, shopID := range scheme.ShopIDs {
			if !targets[shopID] {
				removed = append(removed, shopID)
			}
		}
	}
	for _, shopID := range shopIDs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO visitor_scheme_assignments (shop_id, scheme_id, applied_at)
			VALUES ($1, $2, $3)
			ON CONFLICT (shop_id) DO UPDATE SET scheme_id = EXCLUDED.scheme_id, applied_at = EXCLUDED.applied_at
		`, shopID, scheme.ID, time.Now().UTC()); err != nil {
			return VisitorScheme{}, err
		}
		if err := updateVisitorSchemeSourceSnapshot(ctx, tx, shopID, scheme); err != nil {
			return VisitorScheme{}, err
		}
	}
	defaultScheme, err := getVisitorSchemeTx(ctx, tx, defaultVisitorSchemeID)
	if err != nil {
		return VisitorScheme{}, err
	}
	for _, shopID := range removed {
		if _, err := tx.ExecContext(ctx, `UPDATE visitor_scheme_assignments SET scheme_id = $2, applied_at = $3 WHERE shop_id = $1`, shopID, defaultVisitorSchemeID, time.Now().UTC()); err != nil {
			return VisitorScheme{}, err
		}
		if err := updateVisitorSchemeSourceSnapshot(ctx, tx, shopID, defaultScheme); err != nil {
			return VisitorScheme{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return VisitorScheme{}, err
	}
	return s.GetVisitorScheme(ctx, id)
}

func getVisitorSchemeTx(ctx context.Context, tx *sql.Tx, id string) (VisitorScheme, error) {
	return scanVisitorScheme(tx.QueryRowContext(ctx, `
		SELECT vs.id, vs.name, vs.language, vs.instant_answers_enabled, vs.instant_answers,
		       vs.is_default, vs.created_at, vs.updated_at,
		       COALESCE((SELECT jsonb_agg(vsa.shop_id ORDER BY vsa.shop_id) FROM visitor_scheme_assignments vsa WHERE vsa.scheme_id = vs.id), '[]'::jsonb)
		FROM visitor_schemes vs WHERE vs.id = $1
	`, id))
}

func updateVisitorSchemeSourceSnapshot(ctx context.Context, tx *sql.Tx, shopID string, scheme VisitorScheme) error {
	metadata, err := json.Marshal(visitorSchemeMetadata(nil, scheme))
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE shop_sources SET metadata = metadata || $3::jsonb, updated_at = $4
		WHERE shop_id = $1 AND type = $2
	`, shopID, SourceTypeShopifyChat, metadata, time.Now().UTC())
	return err
}

func (s *PostgresStore) DeleteVisitorScheme(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	scheme, err := getVisitorSchemeTx(ctx, tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if scheme.IsDefault {
		return fmt.Errorf("%w: default scheme cannot be deleted", ErrInvalid)
	}
	defaultScheme, err := getVisitorSchemeTx(ctx, tx, defaultVisitorSchemeID)
	if err != nil {
		return err
	}
	for _, shopID := range scheme.ShopIDs {
		if _, err := tx.ExecContext(ctx, `UPDATE visitor_scheme_assignments SET scheme_id = $2, applied_at = $3 WHERE shop_id = $1`, shopID, defaultVisitorSchemeID, time.Now().UTC()); err != nil {
			return err
		}
		if err := updateVisitorSchemeSourceSnapshot(ctx, tx, shopID, defaultScheme); err != nil {
			return err
		}
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM visitor_schemes WHERE id = $1`, id)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

type visitorSchemeApplyRequest struct {
	ShopIDs []string `json:"shopIds"`
}

func (s *Server) handleVisitorSchemes(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionVisitorSchemesManage)
	if !ok {
		return
	}
	parts := splitPath(r.URL.Path)
	if len(parts) < 3 || len(parts) > 5 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "visitor-schemes" {
		http.NotFound(w, r)
		return
	}
	if len(parts) == 3 {
		switch r.Method {
		case http.MethodGet:
			items, err := s.store.ListVisitorSchemes(r.Context())
			if err != nil {
				writeError(w, err)
				return
			}
			allowed, restricted, listErr := s.moduleScopeShopIDs(r.Context(), user, DataScopeShops)
			if listErr != nil {
				writeError(w, listErr)
				return
			}
			if restricted {
				allowedSet := stringSet(allowed)
				for index := range items {
					filtered := items[index].ShopIDs[:0]
					for _, shopID := range items[index].ShopIDs {
						if allowedSet[shopID] {
							filtered = append(filtered, shopID)
						}
					}
					items[index].ShopIDs = filtered
				}
			}
			writeJSONResponse(w, http.StatusOK, nonNilSlice(items))
		case http.MethodPost:
			if effectiveModuleScope(user, DataScopeShops) != AccessScopeAll {
				writeError(w, fmt.Errorf("%w: access to all shops is required to manage visitor schemes", ErrForbidden))
				return
			}
			var input VisitorScheme
			if !decodeJSON(w, r, &input) {
				return
			}
			created, err := s.store.CreateVisitorScheme(r.Context(), input)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSONResponse(w, http.StatusCreated, created)
		default:
			http.NotFound(w, r)
		}
		return
	}
	if effectiveModuleScope(user, DataScopeShops) != AccessScopeAll {
		writeError(w, fmt.Errorf("%w: access to all shops is required to manage visitor schemes", ErrForbidden))
		return
	}
	id := parts[3]
	if len(parts) == 5 {
		if parts[4] != "apply" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		var input visitorSchemeApplyRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		applied, err := s.store.ApplyVisitorScheme(r.Context(), id, input.ShopIDs)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broadcast(Event{Type: "visitor_scheme.applied", EntityID: applied.ID, Payload: applied, CreatedAt: time.Now().UTC()})
		writeJSONResponse(w, http.StatusOK, applied)
		return
	}
	switch r.Method {
	case http.MethodPatch:
		var input VisitorScheme
		if !decodeJSON(w, r, &input) {
			return
		}
		updated, err := s.store.UpdateVisitorScheme(r.Context(), id, input)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, updated)
	case http.MethodDelete:
		if err := s.store.DeleteVisitorScheme(r.Context(), id); err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		http.NotFound(w, r)
	}
}
