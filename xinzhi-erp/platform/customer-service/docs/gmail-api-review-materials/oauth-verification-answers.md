# Google OAuth Verification Answers

下面内容用于 Google OAuth 审核表单。建议直接用英文提交。

## App name

Xzdesk Mail

## App description

Xzdesk Mail is the email channel in Xzdesk Agent, a local desktop customer service assistant. It helps customer service staff read customer support emails, view email thread history, understand customer issues, and prepare reply drafts.

The app uses Gmail API read-only access only after the user explicitly authorizes a Gmail account. The app does not use Gmail API to send emails. Replies are sent by the user through the Gmail web interface.

## Requested scope

`https://www.googleapis.com/auth/gmail.readonly`

## Scope justification

The app needs Gmail read-only access to read unread customer support emails from the Gmail account authorized by the user. The app displays the email subject, sender, received time, body, and related thread history inside the local desktop customer service assistant so customer service staff can understand the customer issue and prepare a reply.

The app does not send emails through Gmail API and does not modify Gmail mailbox state.

## Why a less sensitive scope is not sufficient

The app needs to read the content of customer support emails and related thread history. Basic profile or sign-in scopes do not provide access to Gmail message content, so they are not sufficient for this customer service use case.

## How the app uses Google user data

Google user data is used only for user-facing customer service features:

- Reading unread customer support emails
- Displaying email message content and thread history
- Helping customer service staff understand customer issues
- Preparing reply drafts in the customer service workflow

## How the app does not use Google user data

The app does not use Google user data for advertising.

The app does not sell Google user data.

The app does not share Google user data with data brokers or unrelated third parties.

The app does not use Gmail API to send emails.

## Data storage and retention

The app is a local desktop application. Gmail message data and OAuth tokens are stored locally on the user's computer unless the user explicitly configures another storage location.

Users can revoke access at any time from Google Account permissions. Users can also delete local application data or uninstall the app.

## Demo video notes

The demo video should show:

1. Opening the desktop app.
2. Selecting a Gmail shop/account.
3. Clicking "API授权" or "Authorize Gmail".
4. Google OAuth consent screen showing the Gmail read-only permission.
5. Completing authorization.
6. Returning to the app.
7. Reading unread Gmail customer emails.
8. Showing that replies are opened/sent through Gmail web, not Gmail API.

## Test account instructions

Use a test Gmail account with sample customer support emails. After authorization, click the read button in the app. The app will display unread customer emails and their thread history. To reply, select a message and use the app's send flow, which opens the Gmail web page for user-confirmed sending.
