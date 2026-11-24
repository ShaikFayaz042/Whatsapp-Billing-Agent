# WhatsApp Billing Agent

An Express.js backend that receives the business owner's WhatsApp voice notes
through the Meta WhatsApp Cloud API, translates the audio with Groq, extracts
billing details, and returns a draft bill preview to the sender.

The project is designed for a tailoring business and accepts free-form item
descriptions, including terms such as blouse, lining, saree fall, pico, dress,
frock, alteration, and kurti.

## Features

- Meta webhook verification handshake
- HMAC SHA-256 verification for webhook deliveries
- In-memory message and status idempotency protection
- Fast HTTP acknowledgement for WhatsApp webhook events
- Text-message handling
- WhatsApp media download
- Hindi and multilingual audio transcription
- Structured bill extraction with Groq
- Quantity and unit-price calculation
- Handling of missing or ambiguous bill details
- MongoDB-backed bill draft and clarification context
- WhatsApp bill previews with Edit, Confirm and Cancel reply buttons
- Short-lived, token-protected mobile web form for bill item editing
- WhatsApp customer selection and contact editing
- PDF bill generation and delivery to the selected customer's WhatsApp number
- Sample webhook signature and idempotency test script

## Tech Stack

| Area                 | Technology                                      |
| -------------------- | ----------------------------------------------- |
| Runtime              | Node.js with ES modules                         |
| Web framework        | Express.js                                      |
| WhatsApp integration | Meta WhatsApp Cloud API / Graph API             |
| Audio transcription  | Groq Whisper Large v3                           |
| Bill parsing         | Groq OpenAI-compatible chat completions         |
| Customer and draft storage | MongoDB with Mongoose                     |
| PDF generation        | PDFKit                                            |
| Configuration        | dotenv                                          |
| Security             | Webhook HMAC, short-lived bill edit tokens      |

This project uses Node's built-in `fetch`, `Blob`, and `FormData` APIs. Node.js
20 or later is recommended.

## How It Works

1. Meta sends a WhatsApp webhook event to `POST /webhook`.
2. The server validates `X-Hub-Signature-256` against the raw JSON request body.
3. The server returns HTTP 200 promptly and processes the event asynchronously.
4. Text, audio, and WhatsApp interactive replies are associated with an active
   bill draft for the sender.
5. For an audio message:
   - The media ID is converted into a temporary Meta media URL.
   - The audio file is downloaded from the allowed Meta hosts into `downloads/`.
   - Groq Whisper transcribes the audio.
   - With a pending clarification, Groq extracts answers against that draft;
     otherwise it extracts a new bill.
   - Extracted answers are merged and validated without replacing unrelated
     customer, item, price, or adjustment information.
   - Incomplete drafts receive only their outstanding clarification questions.
   - Ready drafts receive **Edit**, **Confirm & Send**, and **Cancel Bill**
   reply buttons. Edit opens a menu: contact selection stays in WhatsApp, while
   item editing opens a short-lived mobile web form.
6. Repeated message deliveries and status updates are ignored using an
   in-memory TTL/idempotency map.

## Project Structure

```text
WhatsApp-Billing-Agent/
├── bills/
│   ├── bills.md              # Sample compiled bill records
│   └── *.jpeg                # Source bill/sample images
├── downloads/                # Downloaded WhatsApp media
├── scripts/
│   └── test-webhook-signature.mjs
├── public/
│   ├── edit-bill.html         # Mobile bill item editor
│   ├── edit-bill.css
│   └── edit-bill.js
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   └── env.js
│   ├── controllers/
│   │   ├── bill-edit-web.controller.js
│   │   └── webhook.controller.js
│   ├── models/
│   │   ├── active-bill.model.js
│   │   └── customer.model.js
│   ├── routes/
│   │   ├── bill-edit.routes.js
│   │   ├── health.routes.js
│   │   └── webhook.routes.js
│   └── services/
│       ├── bill-edit-web.service.js
│       ├── bill-pdf.service.js
│       ├── billing.service.js
│       ├── bill-draft.service.js
│       ├── media.service.js
│       ├── parser.service.js
│       ├── transcription.service.js
│       └── whatsapp.service.js
├── .env.example
├── package.json
└── package-lock.json
```

The experimental WhatsApp Flow source is preserved separately in
[`whatsapp-flows/`](./whatsapp-flows/); it is not mounted by the active app.

## Prerequisites

- Node.js 20 or later
- npm
- A Meta developer application
- A WhatsApp Business account and phone number
- A Meta temporary or permanent WhatsApp access token
- A Groq API key
- A public HTTPS URL for production webhook delivery

## Environment Variables

Copy `.env.example` to `.env`, then replace the placeholders:

```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/whatsapp_billing
SEED_CUSTOMERS=false
META_VERIFY_TOKEN=replace-with-your-own-secret
META_APP_SECRET=replace-with-your-app-secret
BILL_EDIT_BASE_URL=https://your-public-server.example.com
OWNER_WA_ID=replace-with-owner-whatsapp-id
WHATSAPP_ACCESS_TOKEN=replace-with-your-access-token
PHONE_NUMBER_ID=replace-with-your-phone-number-id
GRAPH_API_VERSION=v25.0
GROQ_API_KEY=replace-with-your-groq-api-key
```

| Variable                  | Required | Purpose                                                         |
| ------------------------- | -------- | --------------------------------------------------------------- |
| `PORT`                  | No       | HTTP server port. Defaults to `3000`.                         |
| `META_VERIFY_TOKEN`     | Yes      | Secret returned during the Meta webhook verification handshake. |
| `META_APP_SECRET`       | Yes      | Used to validate `X-Hub-Signature-256`.                       |
| `BILL_EDIT_BASE_URL` | For item editing | Public HTTPS origin of this server, without a path or query. |
| `OWNER_WA_ID`           | Yes      | Exact owner sender ID as received in Meta's webhook `from` field. |
| `WHATSAPP_ACCESS_TOKEN` | Yes      | Access token for Meta Graph API media and message operations.   |
| `PHONE_NUMBER_ID`       | Yes      | WhatsApp Business phone number ID used for sending messages.    |
| `GRAPH_API_VERSION`     | No       | Meta Graph API version. Defaults to `v25.0`.                  |
| `GROQ_API_KEY`          | Yes      | API key for Whisper and bill parsing.                           |
| `MONGODB_URI`           | Yes      | MongoDB connection string; startup fails if the connection fails. |
| `SEED_CUSTOMERS`        | No       | Must be `true` to explicitly enable the real customer seed script. |

Do not commit `.env`. The repository's `.gitignore` excludes local environment
files and downloaded media.

## Installation

```sh
npm install
```

Because `package.json` currently uses `nodemon` in the run scripts, install
`nodemon` locally if it is not already available:

```sh
npm install --save-dev nodemon
```

Alternatively, run the server directly with Node.js:

```sh
node src/server.js
```

## Running the Server

Development or nodemon mode:

```sh
npm run dev
```

Start script:

```sh
npm start
```

With the default configuration, the server listens on
`http://localhost:3000`.

The server connects to MongoDB before listening. Set `MONGODB_URI` to a
reachable database; it must not point at a production database during
development. Set `OWNER_WA_ID` to the exact numeric `from` value Meta sends
for the business owner; the server refuses to start without it and ignores
messages from other senders.

## Active Bill Drafts

The `active_bills` collection persists the owner's current draft and stage
(`AWAITING_CLARIFICATION`, `AWAITING_ACTION`, `EDITING_WEB`, or
`SENDING_BILL`). Drafts survive application restarts. A sender has at most one
active draft; an explicitly requested new bill marks the prior draft
`superseded` before starting the new one. Cancelled, sent, and superseded
drafts are retained for traceability, but are not bill history.

When clarification is pending, the next text message or voice note is treated
as an answer to that draft unless it clearly requests a new bill. Answers are
mapped only to fields currently pending; existing fields are otherwise
preserved. For the clarification wording “rate of both is ₹350”, ₹350 is
recorded as the combined line total.

The preview actions are sent to the draft owner only:

- **Edit** opens a menu. Contact changes use the active customer list or a
  WhatsApp-number reply; item changes use a mobile web form.
- The item-edit link is a random, 15-minute bearer token stored only as a hash
  in MongoDB. It is bound to the active bill draft and owner WhatsApp ID, can
  be submitted once, and requires `BILL_EDIT_BASE_URL` to be a public HTTPS
  origin.
- **Edit Items** allows free-form item names, quantities, unit prices or line
  totals, discount, advance payment, and notes. Five item rows are provided;
  leave a row blank to remove it and fill a blank row to add an item.
- The backend validates and recalculates the bill before showing the final
  review. Invalid or incomplete data returns to the item screen.
- **Confirm & Send** generates a PDF and sends it to the selected customer. A
  selected customer must have a valid WhatsApp number.
- **Cancel Bill** marks the draft cancelled and sends a thank-you response.

A bill is claimed atomically before PDF delivery to prevent repeated
confirmations from sending duplicate bills.

Run draft and WhatsApp payload tests with:

```sh
npm run test:conversation
```

## Customer Records

Customer records are stored in the `customers` collection. The schema contains:

- `name`: required display name; surrounding whitespace is trimmed.
- `phoneNumber`: required, normalized E.164 number with an explicit `+` country
  code. The unique index prevents duplicate normalized numbers.
- `aliases`: optional exact-match names, defaulting to `[]`.
- `whatsappOptIn`: explicit WhatsApp consent, defaulting to `false`.
- `isTestCustomer`: test-record marker, defaulting to `false`.
- `status`: `active` or `inactive`, defaulting to `active`.
- `notes`: optional trimmed text.
- `createdAt` / `updatedAt`: maintained by Mongoose timestamps.

Names are not unique. Exact name or alias searches are case-insensitive and
ignore repeated whitespace; multiple matches return `AMBIGUOUS`. Phone numbers
without an explicit country code are rejected rather than guessed. Customer
lookup never creates a record from a voice transcript.

### Add real customers

Edit the local `data/customers.json` file. It is ignored by Git. Add real
customer records with E.164 phone numbers, then explicitly enable seeding:

```env
SEED_CUSTOMERS=true
```

Run:

```sh
npm run seed:customers
```

The seed command uses `MONGODB_URI` from `.env`, marks records as real customers,
and uses the normalized phone number as an upsert key. Reruns do not overwrite
existing customer information. Reset `SEED_CUSTOMERS=false` after seeding.

Run mocked customer and seed tests with:

```sh
npm run test:customers
```

## Webhook Configuration

In the Meta WhatsApp application settings:

- Set the callback URL to `https://<public-host>/webhook`.
- Set the verify token to the value of `META_VERIFY_TOKEN`.
- Subscribe to `messages` webhook fields.
- Use the same app secret as `META_APP_SECRET`.

Meta can issue the same delivery more than once. The server uses a bounded,
in-memory map to keep message and status IDs for 10 minutes. It may process a
delivery again after a server restart or after the TTL/size limit is reached.

### Routes

| Method   | Path         | Description                                         |
| -------- | ------------ | --------------------------------------------------- |
| `GET`  | `/webhook` | Handles the Meta webhook verification challenge.    |
| `POST` | `/webhook` | Validates and processes WhatsApp messages/statuses. |

The project contains a `health.routes.js` module, but it is not currently
mounted in `src/app.js`.

## API Security

- `GET /webhook` accepts only the expected mode and verify token.
- `POST /webhook` requires a valid `sha256` HMAC signature.
- Invalid, missing, or malformed signatures receive HTTP 403.
- Meta-style media URLs are restricted to HTTPS and approved Meta hosts.
- Access tokens and app secrets are loaded only from environment variables.

## Webhook Testing

The test script sends valid and invalid signed payloads to the local server.
It also checks duplicate-message handling.

Start the server in one terminal:

```sh
npm start
```

In another terminal:

```sh
npm run test:webhook
```

The script verifies:

- A valid signature receives HTTP 200
- A wrong signature receives HTTP 403
- A missing signature receives HTTP 403
- A malformed signature receives HTTP 403
- Duplicate delivery is acknowledged and skipped
- A fresh message ID is processed normally

## Message Behavior

### Text Messages

Sending `hi` (case-insensitive) returns:

```text
Namaste! Apne bill ki details voice note mein bhejiye.
```

Other text messages are logged but do not generate an automatic reply.

### Audio Messages

The audio pipeline uses:

- `whisper-large-v3` through Groq's audio translations endpoint to produce English
- `openai/gpt-oss-120b` for structured bill extraction
- `temperature: 0.1`
- JSON response format

Prices are kept with their spoken meaning: `UNIT_PRICE` is stored in `price`,
while `LINE_TOTAL` and `UNCLEAR` amounts are stored in `spokenAmount`.
`priceSource` is `spoken` only when an amount was stated, otherwise it is
`missing`. The preview multiplies an explicitly spoken unit rate by its
quantity; a line total is used once. Missing values are not defaulted, and
unclear amounts remain visible but are excluded from calculated totals.

Before a preview is generated, deterministic bill validation checks that every
item has a name, positive quantity, and a clearly typed price. Voice-extracted
prices must be explicit; values edited in the external web form are treated as
manually confirmed. Unclear fields are sent back as targeted WhatsApp questions
instead of producing a preview. Discount and advance values are checked and
applied when the final bill is calculated.

Example response format:

```text
SHE'S BOUTIQUE TAILORS
CUSTOMER BILL PREVIEW
-------------------
Customer: Lakshmi

Item | Qty | Rate | Amount
Blouse | 2 | ₹350 | ₹700
Saree Fall | 3 | Line total | ₹1200
Lining | 1 | Pending | Pending

-------------------
Known Subtotal: ₹1900
Final Total: Pending missing details.

Preview only — not sent yet.
```

If no billing information is found, the bot returns the transcript and asks the
customer to provide the customer name and items. Processing errors generate a
generic retry message.

Run the bill-validation tests with:

```sh
npm run test:validation
```

## Current Limitations

- Idempotency is held in process memory and is not shared across instances.
- Finalized bill PDFs are sent to WhatsApp but are not archived in a bill-history collection.
- Downloaded media is stored in `downloads/` and is not automatically deleted.
- No health endpoint is mounted yet.
- No authentication is applied to the server outside of webhook signing.
- Native WhatsApp Flow editing is experimental and archived in
  `whatsapp-flows/`; the active workflow uses the external web editor.
- The public API endpoints currently provide no HTTP health or readiness response.
- The `WHATSAPP_VERIFY_TOKEN` name from older documentation is not used;
  the active verification variable is `META_VERIFY_TOKEN`.

## Production Considerations

Before deploying, add:

- Persistent media cleanup
- Persistent idempotency storage
- Database-backed bills and customer records
- Structured logging and request IDs
- Retries and provider timeouts
- Rate limiting
- Health and readiness endpoints
- A process manager or container setup
- HTTPS termination and secrets management
- Tests for bill parsing and webhook event processing

## License

ISC
