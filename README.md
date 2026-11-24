# WhatsApp Billing Agent

A voice-first billing assistant for a tailoring business. The application
receives the owner's WhatsApp messages through Meta's WhatsApp Cloud API,
turns voice notes into validated bill drafts, supports contact and item edits,
and sends a branded PNG receipt to the selected customer.

## Project status

- **Active workflow:** WhatsApp webhook, MongoDB-backed bill drafts, WhatsApp
  reply buttons and customer lists, a short-lived web item editor, and PNG bill
  delivery.
- **WhatsApp Flows:** not mounted or used by the active application. A local
  `whatsapp-flows/` archive may exist, but that directory is git-ignored and is
  therefore not included in normal clones or commits.
- **PDF support:** the PDF generator and PDFKit dependency are retained, but
  confirmed bills currently use the PNG delivery path.

## Capabilities

- Verify Meta webhook requests with an HMAC SHA-256 signature.
- Receive text and voice messages from the configured business owner.
- Download WhatsApp audio and translate it to English with Groq Whisper.
- Extract item names, quantities, prices, discounts, and advance payments with
  a Groq chat model, then validate the result deterministically.
- Preserve incomplete drafts and ask targeted clarification questions.
- Edit the customer in WhatsApp or edit all bill items in a mobile web form.
- Render a branded, portrait PNG receipt locally and send it through WhatsApp.
- Keep one active bill draft per owner and atomically claim it before sending.

## Technology

| Concern | Implementation |
| --- | --- |
| Runtime and HTTP | Node.js ES modules, Express, and built-in `fetch`/`FormData` |
| Messaging | Meta WhatsApp Cloud API |
| Audio translation | Groq `whisper-large-v3` |
| Bill extraction | Groq `openai/gpt-oss-120b` with JSON response mode |
| Persistence | MongoDB with Mongoose |
| Receipt rendering | SVG converted to PNG with Sharp |
| Web item editor | Static HTML/CSS/JavaScript served by Express |

## End-to-end workflow

1. The owner sends a voice note or text to the configured WhatsApp number.
2. The webhook verifies the request signature, acknowledges Meta, and queues
   the message for processing.
3. Voice notes are downloaded, translated to English, and parsed into
   structured bill data. Existing draft data is retained unless a field is
   explicitly updated.
4. Deterministic validation checks item names, quantities, prices, and
   adjustments. Missing or ambiguous details return to the owner as questions.
5. A ready draft is previewed in WhatsApp with **Edit**, **Confirm & Send**, and
   **Cancel Bill** actions.
6. Contact edits use the customer list or a submitted WhatsApp number. Item
   edits open a mobile web form using a random, short-lived, single-use token.
7. Confirmation atomically claims the draft, calculates totals, renders the
   receipt PNG, uploads it to Meta, sends it to the selected customer, and
   marks the draft sent.

### High-level architecture

```text
WhatsApp Voice / Text
        |
        v
   Meta Webhook
        |
        v
  Audio Transcription
   (Groq Whisper)
        |
        v
  AI Bill Extraction
        |
        v
 Deterministic Validation
        |
        v
   MongoDB Draft
        |
        v
 WhatsApp Bill Preview
        |
   +----+-----+
   |    |     |
 Edit Confirm Cancel
   |    |       |
   v    v       v
Web Form PNG Receipt End
           |
           v
     WhatsApp Customer
```

The diagram is intentionally simplified: text messages bypass audio
transcription. **Edit Contact** stays in WhatsApp; **Edit Items** opens the web
form and returns an updated preview.

The application serializes messages per sender within one server process.
MongoDB stores customers and bill drafts; no separate bill-history or
idempotency collection is used.

## Receipt image

The current receipt follows the supplied reference: centered boutique logo,
date in the upper-right, customer and WhatsApp number, navy table and rules,
and a single right-aligned **TOTAL**. It uses a warm off-white background and a
thin outer frame.

- Bill data is rendered as SVG and converted to PNG with Sharp.
- The image is generated in memory; bill images are not permanently stored.
- Item names wrap and the portrait image grows with the rows; text is not
  reduced to fit.
- The image is rejected rather than sent if it exceeds 5,000,000 bytes.
- The logo is a transparent raster asset in `src/assets/boutique-logo.png`,
  derived from the supplied design reference. A higher-resolution or vector
  original would produce a sharper logo.
- The displayed date uses the `Asia/Kolkata` timezone. Indian `+91` phone
  numbers are formatted as `+91 12345 67890`; other numbers are shown as
  supplied.

The receipt intentionally shows only one final total. Discounts and advances
are not itemized on the image; consequently, when a discount applies, the
displayed total can differ from the sum of the visible item amounts.

## Architecture

| Area | Responsibility |
| --- | --- |
| `src/app.js`, `src/server.js` | Express setup, route mounting, MongoDB connection, and startup checks |
| `src/controllers/webhook.controller.js` | Webhook verification, message processing, draft workflow, and confirmed delivery |
| `src/services/transcription.service.js` | Groq Whisper audio translation |
| `src/services/parser.service.js` | Structured bill extraction and edit/clarification parsing |
| `src/services/bill-validation.service.js` | Deterministic completeness and value checks |
| `src/services/billing.service.js` | Line-item calculations, discounts, and preview text |
| `src/services/bill-draft.service.js` | Draft state changes, serialized conversation rules, and send claims |
| `src/services/bill-edit-web.service.js` | Edit-token creation, item validation, and recalculation |
| `src/controllers/bill-edit-web.controller.js` | Token-protected web editor endpoints |
| `src/services/bill-image.service.js` | Reference-style SVG receipt rendering and PNG conversion |
| `src/services/whatsapp.service.js` | WhatsApp message payloads and Meta media upload |
| `src/services/media.service.js` | Authenticated WhatsApp media download |
| `src/models/` | Mongoose customer and active-bill schemas |

### Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/webhook` | Meta webhook verification challenge |
| `POST` | `/webhook` | Signed WhatsApp messages and status events |
| `GET` | `/edit/:token` | Load the bill item editor |
| `GET` | `/edit/:token/data` | Load bill data into the editor |
| `POST` | `/edit/:token` | Validate and save item changes |
| `GET` | `/edit-assets/*` | Serve editor CSS and JavaScript |

`src/routes/health.routes.js` exists but is not mounted. There is currently no
health or readiness endpoint.

## Requirements

- Node.js **20.9 or later** (required by the installed Sharp version)
- npm
- MongoDB (local or hosted)
- A Meta developer app with a WhatsApp Business phone number
- A Groq API key
- Public HTTPS for Meta webhooks; a public HTTPS origin is also required for
  web-based item editing

## Setup

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `.env` and set the values below.
3. Make MongoDB available at `MONGODB_URI`.
4. Configure Meta's callback as `https://<public-host>/webhook`, use the same
   `META_VERIFY_TOKEN`, and subscribe the app to the `messages` webhook field.
5. Set `BILL_EDIT_BASE_URL` to the public HTTPS origin of this server, with no
   path or query string. For local testing, expose the local server with an
   HTTPS tunnel and use that tunnel's origin.
6. Start the server:

   ```sh
   node src/server.js
   ```

The server connects to MongoDB and initializes its models before it listens.
It refuses to start without a numeric `OWNER_WA_ID`. Messages from other
senders are not accepted as owner bill instructions.

The `dev` and `start` npm scripts invoke `nodemon`, which is not declared in
`package.json`. Use `node src/server.js`, or install/configure `nodemon`
separately if you want watch-mode development.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP port; defaults to `3000`. |
| `NODE_ENV` | No | Runtime environment label. |
| `MONGODB_URI` | Yes | MongoDB connection URI; startup fails if unavailable. |
| `OWNER_WA_ID` | Yes | Numeric WhatsApp sender ID for the business owner. |
| `META_VERIFY_TOKEN` | Yes for webhook setup | Secret used in Meta's verification handshake. |
| `META_APP_SECRET` | Yes for signed webhook processing | HMAC secret used to validate `X-Hub-Signature-256`. |
| `WHATSAPP_ACCESS_TOKEN` | Yes for WhatsApp operations | Meta token used for sending and media downloads/uploads. |
| `PHONE_NUMBER_ID` | Yes for outbound messages | WhatsApp Business phone-number ID. |
| `GRAPH_API_VERSION` | No | Graph API version; defaults to `v25.0`. |
| `GROQ_API_KEY` | Yes for voice/parsing | Groq API access for audio translation and bill parsing. |
| `BILL_EDIT_BASE_URL` | Required for item editing | Public HTTPS origin used to construct edit links. |
| `SEED_CUSTOMERS` | No | Defaults to `false`; must be explicitly enabled to run real-customer seeding. |

Keep `.env` out of source control. Use separate development and production
credentials and never point local development at a production database.

### Customer seeding

Add records to the ignored local file `data/customers.json`, set
`SEED_CUSTOMERS=true`, then run:

```sh
npm run seed:customers
```

The seed command upserts by normalized E.164 phone number. Reset
`SEED_CUSTOMERS=false` after seeding. Customer names are not unique; ambiguous
name matches require a selection or phone number.

## Testing

Run focused suites with the existing npm scripts:

```sh
npm run test:billing
npm run test:validation
npm run test:translation
npm run test:extraction
npm run test:customers
npm run test:conversation
```

Run the image renderer and WhatsApp payload tests together:

```sh
node --test tests/bill-image.service.test.js tests/whatsapp.service.test.js
```

For the webhook smoke test, first start the server with a configured `.env`,
then run:

```sh
npm run test:webhook
```

The script requires `META_APP_SECRET` and a server at `WEBHOOK_URL` (defaults
to `http://localhost:3000/webhook`). There is no aggregate `npm test` script;
run the targeted tests above. Root-level `node --test` discovery may also
pick up the webhook smoke-test script, which requires that environment and
server.

## Bottlenecks and trade-offs

| Decision / constraint | Benefit | Cost or failure mode |
| --- | --- | --- |
| Groq handles audio translation and structured extraction | Supports natural voice requests without a fixed command format | Provider latency, outages, rate limits, and model variance; validation and clarification reduce but cannot eliminate extraction errors |
| Webhook returns HTTP 200 before asynchronous processing | Meets Meta's fast-ack expectation and avoids holding the webhook request open during AI work | Processing is not durably queued; a process crash after acknowledgement can lose work without a Meta retry |
| Idempotency and per-sender queues are in memory | Simple, low-latency duplicate suppression and ordered handling in a single process | State is lost on restart, is not shared across instances, and the dedupe cache is limited to 10 minutes and 1,000 IDs |
| MongoDB persists drafts, while sending is coordinated in-process | Drafts survive restarts and atomic claims reduce duplicate sends | There is no durable outbound job queue or automatic recovery for a draft left in `SENDING_BILL` after a rendering or Meta API failure |
| PNG receipt instead of PDF | Opens directly in WhatsApp and matches the desired visual layout | Raster text is not selectable; long bills create tall images and output above 5 MB is rejected rather than paginated or reduced |
| One visible total with no discount/advance rows | Keeps the receipt clean and faithful to the design | A discounted bill's total may not equal the sum of visible item amounts; advances are not shown on the receipt |
| Short-lived web-edit link is a bearer token | No customer account or login system is needed | Anyone holding the link can edit that bill until expiry or first successful submission; use HTTPS and avoid logging or sharing edit URLs |
| WhatsApp media and audio are uploaded/downloaded through Meta | No additional hosting or media service is needed | Customer-service-window/template rules still apply; downloaded source audio remains in `downloads/` until manually removed |
| Local Sharp rendering | Keeps bill data on the application server and avoids a paid image API/browser service | Sharp uses native platform binaries; install dependencies for the deployment OS rather than copying `node_modules` across operating systems |

## Security and operational limitations

- Webhook signatures are checked against the raw request body using
  timing-safe comparison.
- Web edit tokens contain 256 bits of randomness; only the token hash is stored.
  Tokens expire after 15 minutes, are single-use, and responses disable caching.
- The web form is protected by possession of its edit link, not by a user
  account. Treat that link like a secret.
- Customer records and active drafts are stored in MongoDB. Configure database
  access controls, backups, and encryption appropriate to the deployment.
- Incoming audio is saved under `downloads/` and is not automatically deleted.
  Establish a retention policy and cleanup job before production use.
- Logs go to the console and are not centrally correlated or retained by this
  application. Configure deployment logging and redact sensitive identifiers.
- There is no rate limiting, distributed queue, automatic provider retry,
  request timeout policy, or health/readiness endpoint yet.
- Outbound free-form WhatsApp messages are subject to Meta's customer-service
  window. When that window is closed, use an approved WhatsApp message
  template where required.
- A send failure after the draft is claimed can leave it in `SENDING_BILL`.
  There is no automatic retry/release or operator recovery route yet.
- Discounts are applied to the final bill total, but the minimal receipt does
  not display the discount or advance payment separately.

## Project structure

```text
.
├── data/                         # Local customer seed data (ignored)
├── downloads/                    # Downloaded WhatsApp media (ignored)
├── public/                       # Mobile bill editor assets
├── scripts/                      # Webhook smoke test and seed script
├── src/
│   ├── assets/boutique-logo.png
│   ├── config/
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   └── services/
├── tests/
├── .env.example
├── package.json
└── README.md
```

## Production readiness priorities

1. Add a durable queue/outbox and recovery for failed sends.
2. Move idempotency to shared storage before running multiple instances.
3. Add outbound request timeouts, bounded retries, and clear handling for
   ambiguous Meta send results.
4. Add media retention and deletion policies.
5. Add health/readiness endpoints, structured logs, metrics, and alerting.
6. Validate WhatsApp template and customer-consent requirements for the
   business's real messaging patterns.
7. Replace the cropped logo with the original high-resolution/vector artwork
   when available.

## License

ISC
