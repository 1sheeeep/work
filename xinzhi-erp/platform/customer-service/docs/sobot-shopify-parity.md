# Sobot Shopify Parity Map

This document tracks the Shopify customer-service flow we need to match.

## Reference Flow

Sobot's Shopify flow is not just a chat script. The full path is:

1. Install the Shopify app from Shopify App Store.
2. Authorize and bind the Shopify store to a Sobot account.
3. Configure the Shopify channel in the Sobot console.
4. Configure the visitor scheme, which controls the storefront chat button and visitor experience.
5. Configure the reception scheme, which routes Shopify visitors to the right agents or queues.
6. Enable the chat widget in Shopify Online Store theme editor under App embeds.
7. Agents use the workbench to receive messages and query Shopify customer/order information.

Live inspection on 2026-07-07 showed the Shopify channel page has two tabs:

- `Deployment method`: a four-step checklist.
  1. Log in/register Shopify and install the Sobot app from Shopify App Store.
  2. Go to visitor-side settings to configure the Shopify store chat widget style.
  3. Go to reception scheme settings to configure the Shopify store reception scheme.
  4. Go to the Shopify store and enable the Sobot chat plugin in the theme/app embed area.
- `Detail settings`: channel metadata only.
  - Shopify store name.
  - Shopify subdomain.
  - Organization visibility.
  - Notes.

This means Sobot still requires theme/app embed enablement after the Shopify app is installed. The install creates the channel and API binding; it does not replace the merchant-facing setup checklist.

Sobot also exposes a generic website deployment page with:

- Chat link deployment.
- Web widget JavaScript snippet deployment.
- A whitelist option for widget access.

That generic script flow is separate from the Shopify app flow. For Shopify, the durable route is the app plus theme app embed.

## Visitor Scheme Findings

Sobot treats the storefront chat UI as a reusable visitor scheme, not as fields on the Shopify channel itself.

Observed visitor-side settings:

- Scheme list:
  - Scheme name.
  - Reference count.
  - Trigger count.
  - Enable/disable.
  - Edit.
  - Preview.
- Style settings modules:
  - Entry settings:
    - Desktop/mobile website entry enablement.
    - WhatsApp entry enablement.
    - Desktop and mobile position.
    - Side and bottom offsets.
    - System/default or custom icon.
    - Icon size.
    - Solid or gradient background color.
    - Entry text.
    - Desktop and mobile new-message reminder behavior.
  - Chat window settings:
    - Light, dark, or follow-system theme.
    - Main theme color.
    - Text/icon color on theme background.
    - Optional chat background image.
    - Navigation bar display and colors.
    - Navigation content: customer-service info or company info.
    - Avatar, nickname, description, and no-agent display choices.
    - Customer-service message bubble style.
    - Clickable link color in messages.
    - Close button behavior: collapse dialog without ending session, or end session.
  - Input box settings:
    - Separate settings for robot reception and human reception.
    - Default input placeholder.
    - Queueing placeholder.
    - Desktop/mobile/App feature buttons, such as leave message, emoji, service rating, voice, image, camera, and file upload.
  - Sidebar settings:
    - Desktop chat-link-only sidebar helper area.
  - Auxiliary functions:
    - Message read-state display.
    - Message quoting/reply reference.
- Scheme detail tab:
  - Scheme name.
  - Scheme ID.
  - Scheme status.
  - Notes.

The important product lesson is that contact fields such as email/name should not be forced into the first screen. They belong to optional pre-chat/contact collection or inquiry-form behavior, while the normal chat input should let a visitor type a message first.

## Reception Scheme Findings

Sobot treats routing and agent behavior as a separate reusable reception scheme.

Observed reception scheme list:

- Multiple schemes with enable/disable, sort order, trigger audience rule, edit, test, and delete.
- Example schemes include desktop default, mobile default, app, complaint test, and language-specific variants.

Observed reception scheme edit modules:

- Trigger conditions:
  - Conditions based on channel source and customer labels.
- Visitor-side language:
  - Supported language range.
  - Default language.
  - Whether the customer can switch language.
- Referenced visitor-side style:
  - Links this reception scheme to a visitor scheme.
- Customer-service reception mode:
  - Robot first.
  - Human first.
  - Human only.
  - Robot only.
- Customer distribution rule:
  - Depends on customer-service allocation and intelligent routing settings.
  - Supports group reception for skill groups.
- Human customer-service reception:
  - Human transfer success prompt with placeholders such as customer-service nickname.
  - Human welcome message.
  - Option to send welcome again after page refresh.
  - No-agent/agent-offline message.
  - Customer-service nickname/system message display.
  - Customer sends message before allocation behavior.
- Conversation end:
  - Automatic satisfaction rating push.
- More service applications:
  - FAQ.
  - Quick menu.
  - Pre-chat/inquiry form.
- Scheme detail tab:
  - Scheme name.
  - Scheme ID.
  - Scheme status.
  - Notes.

The important product lesson is that "agent must click accept" is not just a workbench issue. It depends on reception mode, allocation rules, online agent availability, and whether a message is moved from visitor/queue into an assigned conversation automatically.

## Current Platform Status

Implemented:

- Shopify app OAuth install.
- Per-shop installation token storage.
- Theme App Extension for the storefront chat widget.
- Public storefront widget script and public chat APIs.
- Internal conversations and messages.
- Agent accounts and shop assignment.
- Basic source list and source enable/disable.
- Shopify Admin API order lookup from the agent workbench.
- Basic visitor settings metadata for widget title, launcher text, and welcome message.
- Optional contact collection in the storefront widget instead of forcing name/email before chat.
- Default assignment of new public conversations to the assigned active shop agent.

Gaps to close:

- A Shopify channel setup wizard matching Sobot's "Docking Channel Settings" flow, with `Deployment method` and `Detail settings` tabs.
- Visitor scheme settings for widget title, button text, launcher position, theme, colors, welcome text, input placeholder, optional pre-chat/contact fields, feature buttons, and allowed domains.
- Reception scheme settings for mode, routing Shopify conversations to assigned agents or queues, offline fallback, welcome/transfer prompts, and skill-group routing.
- App embed enablement status/checklist so merchants know whether the theme widget is active.
- A one-click "go enable app embed" link into Shopify theme editor.
- Workbench customer profile card with Shopify customer, last order, total spend, address, and login/customer-account identity when available.
- Conversation assignment rules instead of only manual assignment.
- Operating pages for SLA, quick replies, FAQ/knowledge base, quick menu, inquiry/pre-chat forms, visitor-side settings, session settings, notifications, satisfaction rating, and statistics.
- Better onboarding copy and setup progress inside our admin UI.

## Priority

1. Deploy current local fixes so the live storefront no longer forces email/name and new messages auto-assign to the assigned agent.
2. Replace the current flat shop/source panel with a Shopify channel detail page:
   - Deployment checklist.
   - Detail settings.
   - Links into visitor scheme, reception scheme, and Shopify theme app embed.
3. Promote the current metadata fields into visitor scheme storage and render the widget from the scheme:
   - Entry label/position/theme/colors.
   - Input placeholder.
   - Optional contact collection.
   - Preview.
4. Add reception scheme storage and automatic routing controls:
   - Human-only default for the current use case.
   - Assigned agent default.
   - Offline/queue prompt.
   - Later: skill groups and robot handoff.
5. Shopify customer/order information enrichment in the workbench.
6. FAQ, quick menu, inquiry form, satisfaction rating, SLA, and statistics after the core reception loop is reliable.

## Next Sobot Areas To Learn

Use the same inspection method for every major customer-service feature:

1. Record the real navigation path.
2. Record filters, dimensions, metrics, and table fields.
3. Record how settings affect the runtime conversation/workbench behavior.
4. Map the feature back to our own database entities, APIs, and UI modules.
5. Separate first-version needs from later enterprise features.

Operational areas to inspect next:

- Conversation statistics:
  - Conversation count.
  - Valid conversation count.
  - Visitor count.
  - New visitor count.
  - Queue/transfer/close outcomes.
  - Channel, shop, agent, and time filters.
- Customer-service performance:
  - Agent online time.
  - Reception count.
  - First response time.
  - Average response time.
  - Average conversation duration.
  - Satisfaction score.
  - Missed/timeout conversations.
- SLA statistics:
  - First-response compliance.
  - Reply timeout count.
  - Resolution/close compliance if available.
  - Alert rules and notification behavior.
- Workbench operations:
  - Accept/assign/transfer/close conversation.
  - Queue behavior.
  - Offline fallback.
  - Quick replies.
  - FAQ and knowledge-base insertion.
  - Order/customer side panel actions.
- Visitor-side service components:
  - Pre-chat/inquiry form.
  - Leave-message flow.
  - FAQ before and during chat.
  - Satisfaction rating after close.
  - Read state and message quote behavior.

## Operational Statistics Findings

Live inspection on 2026-07-08 covered Sobot's monitoring and statistics modules. These findings should drive our later reporting model.

### Real-Time Monitoring

Navigation: `Online Customer Service -> Online Monitoring -> Real-Time Monitoring`.

Observed filters:

- Skill group.
- Department.
- Customer-service scope/status filters.

Observed cards:

- Current robot conversation count.
- Current queued conversation count.
- Current human conversation count.
- Online customer-service count.
- Busy/offline/resting customer-service count.
- Today's average response duration.
- Today's average human reception duration.
- Today's average first response duration.
- Today's human valid reception customer count.

Product meaning: this is an operations control room. It needs live state and counters, not only historical reporting.

### Conversation Statistics

Navigation: `Data Statistics -> Conversation Statistics`.

Observed filters:

- Consultation channel.
- Time zone.
- Time aggregation.
- Conversation start time.
- Department.
- Channel type.
- Specific consultation channel.

Observed tabs:

- Conversation data.
- Conversation message data.

Observed conversation-data metrics:

- Queued conversation count.
- Non-queued conversation count.
- Non-queued connection rate.
- Queued connected conversation count.
- Queued connection rate.
- Queued leave count.
- Queued leave rate.
- Average queued connection duration.
- Average queued leave duration.
- Total conversation count.
- Independent reception conversation count.
- Independent reception rate.
- Valid conversation count.
- Invalid conversation count.
- Valid conversation rate.
- Unrecepted conversation count.
- Unrecepted conversation rate.
- Average reception duration.
- Average first response duration.

Observed message-data metrics:

- Total conversation message count.
- Customer message count.
- Customer-service message count.
- Offline customer-service message count.
- Average messages per conversation.
- Question-answer ratio.
- Average customer messages per conversation.
- Average customer-service messages per conversation.
- Human customer-service word count.
- Average customer-service message words per conversation.
- Human conversation rounds.
- Response warning rounds.
- Response warning rate.

Product meaning: conversation reporting needs both session-level facts and message-level aggregates. First response and response-warning metrics depend on exact message timestamps and sender roles.

### Customer Statistics

Navigation: `Data Statistics -> Customer Statistics`.

Observed filters:

- Skill group.
- Conversation start time.
- Department.
- Artificial customer service.
- Channel type.
- Consultation channel.
- Robot customer service.

Observed overview metrics:

- Total valid customer count.
- New visitor count.
- Returning visitor count.
- Returning visitor ratio.
- 24-hour first-resolution rate.

Observed robot/human reception metrics:

- Robot reception customer count.
- Robot valid reception customer count.
- Robot independent reception customer count.
- Robot independent reception customer ratio.
- Customer actively transferred to human count and ratio.
- Automatically transferred to human count and ratio.
- Transferred-to-human customer count.
- Human reception customer count.
- Human independent reception customer count.
- Human independent reception customer ratio.
- Human valid reception customer count.
- Human valid reception customer ratio.

Observed charts/tables:

- Trend chart.
- Comparison chart.
- Region distribution table with country, region, total visitors, new visitors, and returning visitors.

Product meaning: customer statistics are not just visitor counts. They separate visitor identity, robot handling, human handoff, and human valid reception.

### Customer-Service Statistics

Navigation: `Data Statistics -> Customer-Service Statistics`.

Observed tabs:

- Workload statistics.
- Work status.
- Time-sliced reception statistics.

Observed workload filters:

- Skill group.
- Time zone.
- Time aggregation.
- Conversation start time.
- Department.
- Human customer service.

Observed workload fields:

- Customer-service nickname.
- Customer-service email.
- Customer-service skill group.
- First login time.
- First online time.
- Online duration.
- Busy count.
- Total conversations.
- Valid conversations.
- Invalid conversations.
- Invalid reception conversations.
- Independent reception conversations.
- Valid leave-message conversations.
- Valid reception conversations.
- Valid interactive conversations.
- First-reception first-response conversation count.
- Transfer duration.

Observed work-status fields:

- Customer-service nickname.
- First login time.
- First online time.
- Online duration.
- Busy count.
- Busy duration.
- Rest duration.
- Meal duration.
- Active duration.
- Training duration.
- Meeting duration.
- Last offline time.

Observed time-sliced reception filters:

- Skill group.
- Time zone.
- Conversation start time.
- Time segment.
- Time bucket dimension, such as half-hour.
- Department.
- Human customer service.

Product meaning: agent performance needs an agent status event stream, not only conversations. Reply speed, workload, and status duration must be computed from separate but joinable event facts.

### Skill-Group Statistics

Navigation: `Data Statistics -> Skill Group Statistics`.

Observed tabs:

- Reception pressure statistics.
- Time-sliced reception statistics.

Observed pressure metrics by time bucket:

- Queued conversation count.
- Non-queued conversation count.
- Human conversation count.
- Queued leave conversation count.

Observed dimensions:

- Skill group.
- Time zone.
- Conversation start time.
- Time segment.
- Time bucket dimension.
- Department.

Product meaning: skill-group reporting is for staffing pressure and routing quality. It should be available before advanced routing is fully automated.

### Satisfaction Statistics

Navigation: `Data Statistics -> Satisfaction Rating Statistics`.

Observed tabs:

- Conversation satisfaction statistics.
- Customer satisfaction statistics.

Observed filters:

- Department.
- Time zone.
- Conversation start time.
- Human customer service.
- Channel type.
- Consultation channel.

Observed conversation-satisfaction metrics:

- Human valid conversation count.
- Rating count.
- Rating participation rate.
- Valid reception conversation rating participation rate.
- Customer active rating count and rate.
- Customer-service invitation rating count and rate.
- Customer-service invitation participation rate.
- Unresolved rating count.
- Two-level rating metrics: satisfied conversation count/rate, dissatisfied conversation count/rate.
- Star rating metrics: average score, positive/neutral/negative rating counts and rates.

Observed customer-satisfaction metrics:

- Human valid customer count.
- Human valid reception customer count.
- Rating customer count.
- Resolved-rating customer count.
- Active-rating customer count.
- Customer-service invited customer count.
- Customer-service invited rating customer count.

Product meaning: satisfaction must support different rating schemes and both conversation-level and customer-level rollups.

### Service Summary Statistics

Navigation: `Data Statistics -> Service Summary Statistics`.

Observed filters:

- Service category.
- Time aggregation.
- Created time.
- Final reception skill group.

Observed table dimensions:

- Service category.
- Date.

Observed metrics:

- Total conversation count.
- Customer-service invited rating count.
- Customer active rating count.
- Rating count.
- Star rating counts.
- Numeric score rating counts.

Product meaning: service summary requires agents or automation to attach service categories when closing/summarizing conversations. Without that close-summary data, this report cannot exist.

### Order Statistics

Navigation: `Data Statistics -> Order Statistics`.

Observed purpose text: order statistics measure orders promoted after customer-service communication and are used for customer-service KPI evaluation.

Observed filters:

- Skill group.
- Order time.
- Department.
- Skill group.
- Human customer service.
- Attribution window, such as orders within 24 hours.
- Channel type.
- Consultation channel.

Observed table fields:

- Customer-service name.
- Skill group.
- Ordering customer count.
- Order count.
- Order amount.
- Average order value.

Product meaning: Shopify order reporting requires conversation-to-order attribution. The first usable version can use a simple time-window attribution by customer email/account/order customer, then later add stricter attribution rules.

### SLA Statistics

Navigation: `Data Statistics -> SLA Statistics`.

Observed filters:

- Consultation channel.
- Time zone.
- SLA target update date.
- SLA rule.
- SLA target.
- Conversation start time.
- Department.
- Customer service.

Observed overview metrics:

- SLA conversation count.
- Compliant conversation count.
- Timeout conversation count.
- Not-executed and not-timeout conversation count.
- Compliance rate.
- Timeout rate.

Observed charts/dimensions:

- SLA compliance trend.
- Compliance by SLA rule.
- Compliance by consultation channel.
- Compliance by skill group.
- Compliance by human customer service.

Product meaning: SLA needs explicit rule/target definitions plus event-based execution records. It must be traceable from aggregate timeout rate back to channel, skill group, and agent.

## Reporting Model Implications

For our platform, do not start reporting with a single aggregate table. The minimum durable model should distinguish:

- Conversation facts:
  - Created time.
  - Channel/source/shop.
  - Queue entry/exit.
  - Assigned agent.
  - Skill group.
  - First customer message time.
  - First agent response time.
  - Closed time.
  - Close reason.
  - Valid/invalid state.
- Message facts:
  - Conversation.
  - Sender type.
  - Sent time.
  - Message type.
  - Word/message count contribution.
  - Response warning status.
- Agent status events:
  - Agent.
  - Status.
  - Start/end time.
  - Department/skill group at the time.
- Customer facts:
  - Visitor/customer identity.
  - New/returning classification.
  - Channel/source.
  - Robot/human handling path.
- Satisfaction facts:
  - Conversation/customer.
  - Rating type.
  - Score/value.
  - Invited vs active rating.
  - Resolved/unresolved marker.
- SLA facts:
  - SLA rule and target.
  - Conversation.
  - Execution state.
  - Deadline.
  - Completion time.
  - Timeout/compliance.
- Order attribution facts:
  - Conversation/customer.
  - Shopify order.
  - Attribution window and method.
  - Order amount and currency.
