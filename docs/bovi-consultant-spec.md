# BOVI — production specification for the Instagram AI consultant

Status: canonical implementation specification  
Vertical: `VERTICAL=consultant`  
Store: BOVI  
Channel: Instagram Direct through Zernio  
Model: Claude Haiku 4.5, configurable through environment

This document is the repository source of truth distilled from:

- `FrogFlow_BOVI_Claude_Architecture_Full_Handoff.pdf`;
- `Техническое_задание_без_черты.pdf`;
- real BOVI Direct conversations supplied by the customer.

If examples from real conversations conflict with the signed technical
specification, the technical specification wins.

## Product boundary

The consultant is a dedicated BOVI vertical. It is not the digital shop,
confectionery shop, a generic AI builder, or a checkout bot.

Included:

- consultation about BOVI assortment, variants, stock and price;
- Kazakhstan and Russia;
- KZT and backend-calculated RUB prices;
- BOVI website link for the full catalog and detailed photos;
- handoff to a human manager;
- hard pause after a manager intervenes.

Excluded:

- checkout and payment;
- loyalty points;
- direct 1C API integration;
- calculation of CDEK delivery price;
- image recognition;
- autonomous discounts, reservations or delivery promises;
- other channels until the Instagram flow is accepted.

## Responsibility split

Claude is responsible for:

- understanding free customer language and conversational context;
- extracting product, category, size, color, brand and country;
- deciding which backend tool is needed;
- asking a useful clarification when data is insufficient;
- selecting relevant confirmed variants;
- recognizing contextual purchase intent;
- writing the final concise BOVI response from tool facts.

Backend is responsible for:

- webhook validation, message identity, ordering and retries;
- session state, idempotency and pause;
- catalog import, normalization, search and freshness;
- VTB rate retrieval, storage and RUB calculation;
- tool execution;
- response grounding and policy validation;
- exact regulated transition messages;
- Instagram delivery and observability.

Claude is never a source of product, price, stock, currency or delivery
facts. The full catalog is never included in a Claude request.

## Tone of voice

- Businesslike, concise and factual.
- Address the customer formally (`Вы`).
- No emojis in automated messages.
- No emotional praise or sales clichés.
- Never use: `Отлично`, `Прекрасный выбор`, `Замечательно`,
  `Будем рады помочь`, `Передаю ваш диалог менеджеру`, or close
  equivalents.
- A customer's name may be used once when reliably available.

## Regulated messages

The following copy is sent exactly (dynamic placeholders aside).

### Country

> Здравствуйте! Подскажите, пожалуйста, из какой вы страны, чтобы мы показали актуальные цены и условия доставки?

Buttons: `Казахстан`, `Россия`.

### Product request

> Какой товар, размер или расцветка вас интересуют? Напишите, пожалуйста:

### Product facts

The final response must contain:

1. product name;
2. size label without inventing a unit;
3. available colors;
4. confirmed stock;
5. final KZT or RUB price.

For a first Russian price in the active session, append:

> Доставка осуществляется курьерской службой СДЭК и оплачивается покупателем при получении по тарифам СДЭК.

End a successful product answer with:

> Может, вас интересует что-нибудь ещё из нашего ассортимента?

### Other categories

> В нашем ассортименте также представлены: матрасы, одеяла, подушки, посуда, постельное бельё и полотенца. Напишите интересующую позицию или категорию для проверки наличия и стоимости.

The tool result, not this sentence, defines the actual catalog coverage.

### Full catalog or detailed photos

> С полным каталогом и подробной информацией о товарах вы можете ознакомиться на нашем сайте: bovi.kz. Если потребуется уточнить наличие конкретной позиции, напишите сюда.

### Confirmed out of stock

> Данного товара сейчас нет в наличии. В ближайшее время с вами свяжется менеджер и предложит доступные альтернативы.

This message creates a manager task and pauses automation because it promises
human follow-up. An unclear request is not out of stock: Claude asks a
clarifying question first.

### Confirmed purchase

> Спасибо! В ближайшее время с вами свяжется менеджер для оформления заказа.

This message creates a manager task and immediately pauses automation.

### Technical failure or unrecognized request

> Спасибо за обращение! В ближайшее время с вами свяжется менеджер для консультации.

This message creates a manager task and pauses automation. It is used only
after a model/tool failure or after a useful clarification is impossible.

## Conversation rules

1. If country is unknown, ask the country before quoting product prices.
2. Explicit cities/regions may map to KZ or RU only when the mapping is
   deterministic. An unsupported country goes to a manager.
3. A bare `как заказать?` asks country and does not start checkout.
4. A bare `давайте` is purchase intent only when recent context contains a
   selected product or explicit order/payment discussion.
5. `что купить`, advice and a budget are consultation, not purchase.
6. `ещё варианты` uses last product context and must not repeat the shown
   card.
7. A category without a size may return several confirmed sizes and ask
   which one is needed.
8. A story reply with only `цена` uses referred-product metadata when
   available; otherwise it asks what product is shown.
9. Thanks receives a short polite response and no unsolicited catalog.
10. No follow-up is sent without a new customer message.
11. A broad request — a brand or a category with no size and no color —
    is answered in three lines: the goods are in stock, one or two lines
    about the brand taken from the knowledge base, and a question about size
    and color. The search tool returns a summary with no cards for such a
    request, so there is nothing to list. The full list belongs to a request
    that already carries a filter, or to an explicit «покажите все».
12. A question about one product is answered with what is known about it and
    with what the knowledge base says about its brand and collection. The
    reply never explains that the catalog lacks a field; a manager is offered
    only for a specific figure that exists nowhere and is needed to decide.

## Catalog

The configured primary source is one of:

- Google Sheet;
- a Drive file;
- a manually uploaded XLSX/CSV snapshot.

The normalized variant supports:

- stable `id`/SKU;
- `name`;
- `category`;
- optional `brand`, `material`, `season`, `description`;
- `size_label` (already including the correct unit);
- colors;
- `price_kzt`;
- stock and optional quantity;
- optional product and image URL.

Imports are validated and published atomically. A failed import keeps the
last good snapshot and records the failure. Catalog version and import time
are attached to every response trace. A missing or unacceptably stale
snapshot cannot be used to promise price or stock.

### Mattress firmness

Firmness is read from the product name when the export has no column for it
(`Dorelan LEVANT R4 SOFT`). A different firmness is a different product and
is never offered as a substitute.

MEDIUM mattresses are discontinued. They are filtered out when the catalog is
read, so they reach neither the search tools nor the prompt, and a sentence
that offers one is removed from the outgoing reply. Mattress protectors,
toppers and pillows are not affected: only mattresses are withdrawn. When the
customer asks for medium firmness, the answer says plainly that it is not
sold and offers the firmness levels that are, without naming a return date.

Firmness is named to the customer as «комфортный (Soft)» and «упругий
(Firm)» — the seller's wording. Factory model names keep their own spelling.
Both Russian words are understood on the way in as well, so a customer who
repeats them still gets a filtered search.

## Currency and delivery

VTB Kazakhstan answers only requests coming from inside Kazakhstan; from
anywhere else the connection is dropped. The deployment runs abroad, so the
direct call cannot succeed there and no combination of headers changes that.
`CONSULTANT_VTB_RELAY_URL` names an address inside Kazakhstan that returns the
VTB response unchanged and is tried first; the direct addresses stay in place
for a deployment that ever runs in Kazakhstan. Without a relay the rate is
entered by hand in the panel, which shows the last attempt and why it failed
rather than leaving a silently stale rate.

KZ uses the KZT price from the current catalog.

RU price is calculated by backend:

`price_rub = round(price_kzt / (vtb_buy_rate * 0.95))`

The scheduled job refreshes the VTB Kazakhstan RUB buy rate every 15 minutes.
When VTB is unavailable, keep the last successful VTB rate. Do not substitute
the National Bank rate. If no successful VTB rate exists, do not quote RUB;
perform safe handoff.

CDEK delivery price is never calculated or promised.

## Message ledger and pause

Every incoming Zernio event/message has a durable unique record. Webhook and
poll are two ingestion paths for the same record, not two responders.

Required statuses:

`received → processing → replied`

Failure statuses record a retryable or terminal reason. Outbound idempotency
is derived from the incoming message ID and response attempt.

Human intervention is a hard lock:

- any non-bot outgoing message pauses the conversation;
- pause is checked before Claude and immediately before send;
- an in-flight or queued response is cancelled when the lock is observed;
- human and purchase locks are removed only by an explicit admin action.

## Tools

- `search_products`
- `get_product`
- `list_categories`
- `get_catalog_link`
- `get_delivery_info`
- `get_current_rate`
- `handoff_to_manager`

Tools return compact structured facts. `exclude_ids` is used only when the
customer asks for alternatives.

## Validation

Before send, validate:

- product IDs and names;
- size labels;
- colors;
- stock;
- KZT/RUB prices and currency;
- VTB rate provenance;
- required CDEK copy;
- forbidden phrases;
- absence of a delivery quote, discount or unsupported promise;
- required pause for handoff;
- response length.

One grounded repair round is allowed. A second validation failure uses the
regulated technical-failure handoff.

## Observability

Each run records:

- request, event and message IDs;
- conversation and BOVI user ID;
- webhook or poll source;
- model and prompt version;
- catalog version and rate timestamp/source;
- sanitized tool calls and selected product IDs;
- token usage and latency;
- validator result;
- send result;
- pause/handoff changes and error class.

Never store or log credentials.

## Admin panel

The BOVI panel contains:

- Overview: Instagram, Claude, catalog, VTB, incidents and global pause.
- Dialogs: transcript, state, trace, tool calls, handoff and pause/resume.
- Catalog: source, freshness, imports, errors and searchable preview.
- AI and test: model/prompt version and a no-send scenario simulator.
- Diagnostics: durable runs, retries, webhooks, manager detection and cron.

Production prompt is versioned in code and shown read-only. A/B copy and
acceptance checklists are not primary operator controls.

## Acceptance

- Exactly one answer per new incoming message.
- No message after customer silence.
- No automated message after human intervention.
- Claude handles free language and tools; local intent regex does not drive
  ordinary consultation.
- Every product fact is traceable to a current tool result.
- KZ and RU output follows this specification.
- VTB and catalog outages fail safely.
- All regulated copy is exact.
- Unit, contract, model-eval and live BOVI Instagram scenarios pass.

