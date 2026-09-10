import { captureNativeLink, readNativeLink } from "./nativeLinkState";
captureNativeLink();
// A reload on the login route must resume expiry cleanup as well.
readNativeLink();
