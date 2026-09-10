package platform

import (
	"net/http"
	"time"
)

// externalHTTPClient bounds provider calls that previously inherited the
// process-wide client without an overall deadline.
var externalHTTPClient = &http.Client{Timeout: 45 * time.Second}
