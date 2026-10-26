# WhatsApp Billing Agent Server

## Setup

```sh
npm install
```

Copy `.env.example` to `.env` and set `WHATSAPP_VERIFY_TOKEN`, then start the server:

```sh
npm start
```

The health check is available at `GET /health`. Configure the WhatsApp webhook URL as `/webhook`; verification is supported, while event processing and billing integrations are placeholders.