# Что платформа уже знает

Это опись знания, добытого на живых клиентах. Она собрана механически — из
имён проверок и из истории правок — и существует ради одного: при переписывании
платформы ни одна строка отсюда не должна быть потеряна.

Каждое имя проверки ниже — требование, которое кто-то когда-то нарушил в проде.
Каждая правка — поломка, которую увидел покупатель или продавец. Переписанная
платформа готова не тогда, когда она работает, а тогда, когда проходит всё,
что перечислено здесь.

Файл собирается заново командой `npm run knowledge` — руками его не правят.

## Поломки, которые уже случились (51)

Правки, сделанные по факту сбоя у клиента. В теле каждой записан симптом и
причина — это самое дорогое, что есть в репозитории.

### fix(consultant): считать запись в кеш по той ставке, по которой её берут

`5d3a5b8`

Точек кеша у консультанта две, и ставки у них разные: системный промпт с
инструментами пишется на час (×2), хвост переписки — на пять минут (×1,25).
Запись приходила одной общей цифрой, и вся она считалась по часовой ставке —
хвост выходил дороже, чем стоит на самом деле.

Пока счёт был внутренней оценкой, это была неточность. С клиента теперь
берут по факту расхода токенов, и завышение — такая же ошибка, как недосчёт.

Ответ API даёт разбивку записи по TTL отдельным объектом cache_creation;
теперь она читается, каждая часть считается по своей ставке, и обе цифры
ложатся в строку журнала — счёт можно пересчитать, не заглядывая в API.
Если разбивки в ответе нет, остаток считается по TTL вызова, как раньше.

Заодно сложение раундов переехало из claude.ts в addTokenUsage рядом с типом:
сложение по полям на месте уже один раз молча теряло новое поле.

### fix(consultant): notify every manager listed, and say who did not get it

`c8a5f84`

The seller filled five Telegram ids in the panel, pressed the test button and
one of his two phones received anything. The consultant's notifications went to
bots.owner_telegram_id alone — a single recipient that happened to be first in
his list — while the shop side had always delivered to the whole admin_chat_id
list. Two ideas of the same thing, and the panel only offered the list.

Notifications now go to the owner and every id from the settings, deduplicated.
One refusal no longer cancels the rest.

The test button was worse than silent: it reported success whatever Telegram
answered, because the result was logged and thrown away. It now names who
received the message and who did not, with the reason in plain words — a
manager who has never opened the bot is told to send it /start, which is the
most common case and was invisible.

### fix(consultant): keep quiet for half an hour after a manager speaks

`307f961`

Two holes left after the ordering fix. The window started at the bot's own last
reply, so a manager whose message the bot had already talked over disappeared
from view for good — exactly the dialogue the seller sent. The last thirty
minutes of a conversation are now always examined, whatever the bot did in
between.

That widening needs a reliable answer to "did we say this?", and process memory
is not one: on serverless the next request is a new instance that has forgotten
its own words within a minute. The ledger remembers, so the check now reads the
bot's recent replies from it.

### fix(zernio): read the last hundred messages of a conversation, not the first

`9e5d271`

The probe answered it. Zernio returns at most a hundred messages and we asked
for them in ascending order, so in a dialogue with more than that we received
the beginning of the correspondence: in the live BOVI conversation the newest
outgoing message in our answer was five days old. Every check that reads a
conversation — the manager guard above all — was looking at last week and
finding nothing, which is why the bot kept talking over a manager who had just
written.

We now ask for the newest hundred and restore chronological order ourselves
rather than trusting the parameter to be honoured.

### fix(consultant): show what Zernio returned, not just that it returned something

`3b5ddb9`

The ledger now says the check runs and sees a hundred messages and still finds
no manager, which is exactly as unhelpful as it sounds: "he is not there" and
"we are reading the wrong field" look identical. Both the ledger row and a new
internal probe now report the shape — the key names on a message, the count per
direction value, how many come out with empty text after normalisation, and the
newest outgoing timestamp. No message text leaves the deployment.

### fix(zernio): read the message text Zernio actually sends

`2e8feb4`

The webhook log shows what a Zernio message looks like: id, text, isRead,
sender, sentAt, sentVia, platform, direction. Our code reads `message` and
`createdAt`. Every consumer of a conversation's history — the manager check,
the outgoing poll, the missed-incoming poll — therefore saw messages with no
text and no time, and treated them as if they were not there. That is why a
manager's message has never once paused a dialogue.

The list endpoint now normalises both spellings the moment the answer arrives,
so nobody downstream has to know there were two.

Whether the list really uses the webhook's spelling is still unproven: it is
the one shape we have evidence for, and reading both costs nothing. The ledger
records what the check saw on every message, so the next case will say plainly
which it was.

### fix(consultant): say which build is live and what the manager check saw

`5aa223f`

The seller sent a dialogue from 14:12 where a manager wrote "сейчас не
работаем", the customer answered and the bot carried on with a price list. The
guard shipped two hours earlier, its logic returns the manager's message on
exactly this transcript, the production build is clean and the cron is running.
That leaves two candidates — the build never reached the deployment, or Zernio's
inbox does not list a message the manager sent from the Instagram app — and
nothing in the system could tell them apart.

So both are now observable. The health report carries the commit, branch and
environment Vercel built from, which answers "is my fix live" without guessing.
And every message in the ledger records what the manager check saw: how many
messages Zernio returned, whether one of them was a manager's, or which error
stopped the check. A pause writes its own row too, so a silent bot is no longer
indistinguishable from a bot that never got the message.

### fix(consultant): stop talking over a manager who is already in the chat

`8a80ba9`

The seller says the bot does not notice a human answering and keeps going. The
database agrees: thirteen BOVI dialogues and not one pause with the reason
manager_intervention.

Both detectors were dead. The webhook branch waits for an outgoing message
event, and Zernio never sends one — a day of the log holds message.received and
comment.received and nothing else. That left a poll every fifteen minutes which
required the manager's message to be the last in the conversation, so a
customer replying to the manager hid it entirely.

Now the tail of the conversation is read before every reply: an outgoing
message newer than the bot's own last reply, and not its own words, pauses the
dialogue and the answer is not sent. Our own message coming back through the
feed a minute late is not a manager, and neither is an outgoing message from
last week in a dialogue the bot has not answered yet. The poll survives as a
backstop and scans the tail with the same rule.

This costs one Zernio call per incoming message. A bot interrupting a live
manager costs more.

### fix(consultant): read 140x70 and 70x140 as one size, answer the question asked

`02252ff`

The seller sent two live cases.

Asked for a towel 140x70, the bot said the catalog has no such size and
offered 70x140 as a close one. It is the same towel written the other way
round. Sides are now compared as an unordered pair inside the same 3 cm
tolerance, a three-sided size is compared on its two largest sides, and
«70 на 140» is understood as well.

Asked how tall the LEVANT mattress is, the bot gave the height and then
unloaded four models with prices. A question about one property now gets that
property and an offer of details, and the search summary starts at four
matches instead of five.

### fix(consultant): answer broadly first, and say why the VTB rate is stuck

`2fbe4bf`

Three notes from the seller this morning.

The rate does not refresh. VTB Kazakhstan drops the connection for every
request from outside the country — checked from two unrelated networks — and
the deployment runs in Seoul, so the direct call can never succeed there. The
panel used to say only "service unavailable". It now shows the last attempt,
the reason, and what to do about it. CONSULTANT_VTB_RELAY_URL takes an address
inside Kazakhstan that returns the VTB response unchanged and is tried first;
the direct addresses stay for a deployment that ever runs there. Attempt
timeouts drop from 12 to 6 seconds with a 20-second ceiling on the whole
sweep: the old worst case outlived the cron and took the catalog refresh down
with it.

Asked about a brand or a category, the bot printed the whole price list. A
rule in the prompt does not hold while the model can see forty cards, so a
broad request — no size, no color, no firmness, no budget — now comes back as
a summary with no cards at all: how many there are, which sizes and colors
exist, the price range. The answer becomes one line that they are in stock,
one or two about the brand from the knowledge base, and a question about size
and color. Full lists stay for requests that carry a filter and for an
explicit "покажите все", which is a new show_all switch on the tool.

Asked about one towel, the bot explained that the catalog has no detailed
characteristics for that model. The customer has no use for how our database
is arranged. Such a sentence is now cut from the reply, and the prompt says to
answer with what is known about the item and what the knowledge base says
about its brand, leaving the manager for a figure that exists nowhere.

### fix(consultant): stop offering medium-firmness mattresses and fix mangled category names

`81cf8ef`

The seller reported three things in one evening.

Medium-firmness mattresses are discontinued and must not be mentioned. The
1C export still ships them while stock is on the books, so they are now
dropped when the catalog is read: they reach neither the search tools nor the
prompt, and a sentence offering one is cut from the outgoing reply. Only
mattresses are withdrawn — protectors, toppers and pillows with MEDIUM in the
name stay on sale. Asked about medium firmness, the bot now says plainly that
it is not sold instead of inventing a reason for the empty result.

The category list came out as «Матрасы и topper», «Постельное belle». The
brand speller built its vocabulary from every latin word in a product name,
so TOPPER and Belle from the middle of names became «brands» and ordinary
Russian words were rewritten into them. The vocabulary now takes only the
first latin word of a name, and product vocabulary is never rewritten.

Firmness is named to the customer as «комфортный (Soft)» and «упругий
(Firm)», as the seller asked, and both words are understood on the way in.

Also fixed on the way: a query for mattresses no longer returns mattress
protectors, and the panel shows how many rows are hidden as discontinued.

### fix(consultant): keep budget picks in category, latin brands, no emoji

`2bd84d5`

Разбор второй сессии тестирования продавцом.

Подушка вместо одеяла. На «одеяло за 100 000 ₸» бот назвал «самым
доступным вариантом» подушку Traumina Cube Junior Natur 40х60 за 30 000 —
другая категория, другой размер. Та же подмена категории, что чинили в
поиске, но в бюджетной ветке: productsUnderBudget брал весь каталог, а
suggestForBudget намеренно смешивал категории — это писалось под «соберите
набор». Теперь категория из фразы клиента сужает подбор, а сборка набора
без категории работает как раньше.

Полуправда про диапазон. Бот сказал, что 100–150 тысяч это «довольно узкий
ценовой сегмент», хотя по каталогу одеял дешевле 170 000 нет вообще.
Появилось priceFloorInScope: ценовое дно того же среза без потолка цены.
Инструмент отдаёт его полем cheapest_ignoring_price_limit, локальный
шаблон называет позицию прямо, промпт требует говорить это вместо
смягчения.

Бренды. «Травмина» вместо «Traumina» — причём в том же сообщении строкой
выше марка написана верно. Правило в промпте было, не помогало. Теперь
механика: список марок собирается из латинских слов в названиях каталога,
кириллическое написание опознаётся транслитерацией с допуском в одну
правку на пять символов и возвращается к фабричному.

Тон. «Восторженных сообщений с восклицательными знаками не делать. Эмодзи
запретить». Прощание с «Мы всегда готовы помочь. 😊» сочинила модель —
обработчика /stop в консультанте нет. Зачистка добавлена в единственную
точку выхода наружу, поэтому покрывает и ответы модели, и локальные
шаблоны. Эмодзи в notify.ts не тронуты: это метки в уведомлениях
менеджеру, а не текст покупателю.

Промпт: не спрашивать про бюджет самому (вопрос «какую сумму готовы
потратить» запрещён) и приводить характеристики формулировкой источника,
а не пересказом. Проверено по загруженным файлам: слова «дышащесть» там
нет, в документах «дышащие ткани» и «воздухопроницаемость» — бот слепил
его сам.

### fix(consultant): keep cache tokens when summing rounds of one message

`99f68e9`

Хвост вчерашней правки учёта. На одно сообщение клиента приходится до
четырёх вызовов подряд, и их usage складывается в цикле. Складывались
только input и output: объект пересобирался из двух полей, и поля кеша со
второго раунда пропадали. То есть у любого сообщения, где бот сходил в
инструменты, из учёта выпадал почти весь ввод — ровно то, что правка
неделей раньше должна была вернуть.

### fix(consultant): bill the cached prompt, and hold the cache for an hour

`49cf2e7`

Кеширование промпта у консультанта было включено и работало: брейкпоинты
стоят на блоке инструментов и на системном промпте, волатильный контекст
сессии идёт после них. По боевым данным на вызов приходится 3 180 входных
токенов при системном промпте примерно в 69 000 — то есть из кеша
приходит около 95%.

Но эти 95% не попадали в расход. extractAnthropicUsage читал только
input_tokens и output_tokens, а API возвращает в input_tokens лишь то, что
НЕ попало ни в запись, ни в чтение кеша. Накопленный счёт — тот самый,
который выставляют клиенту и обнуляют после оплаты, — считался по
нескольким процентам потребления.

- usage несёт cacheCreationTokens и cacheReadTokens, стоимость считается с
  множителями 2 (запись при часовом TTL) и 0,1 (чтение);
- накопленный и дневной расход хранят их отдельными строками; старые
  записи читаются как нули — задним числом разбивку взять неоткуда,
  API отдаёт её только в ответе на вызов;
- запись расхода больше не отбрасывает вызов, у которого input_tokens мал:
  при работающем кеше это обычное дело, а деньги вызов всё равно стоит.

TTL поднят с пяти минут до часа. Замер по журналу событий бота: медиана
промежутка между сообщениями 10,6 минуты, 43% промежутков попадают в
интервал 5–60 минут. Пятиминутный кеш до половины сообщений не доживает и
платит за перезапись, часовой — доживает. Запись при этом дорожает вдвое,
но окупается двадцатью попаданиями.

### fix(consultant): treat a blank quantity in a stock report as "not in stock"

`9ade093`

Сверка разбора с боевым каталогом (877 позиций) дала одно расхождение:
Friedola Topfit 110 см. В базе позиция лежит как отсутствующая, а после
вчерашней правки пустой ячейки остатка стала бы «в наличии».

Права база. Пустая ячейка в отчёте ОБ ОСТАТКАХ означает «неизвестно», и
обещать по ней наличие нельзя — бот предложит то, чего на складе нет.
Поэтому товар без числа считается отсутствующим, когда колонка остатка в
выгрузке есть вообще. Прайс без такой колонки — другой случай: там наличие
не ведётся, и всё по-прежнему считается доступным, иначе любой простой
прайс импортировался бы целиком распроданным.

После правки разбор боевого файла совпадает с тем, что лежит в базе, один
в один: 877 из 877 по названию, цене, категории и наличию. То есть
переимпорт этого прайса через админку ничего не изменит — а до вчерашнего
фикса цен он обнулил бы каталог.

### fix(consultant): read the real 1C price export instead of importing nothing

`ac49123`

Боевой файл «Остатки товара по складам с ценами» от 10.09.2026 (879
позиций) импортировался как 0 товаров и 0 ошибок — молча.

Цена в этом отчёте выглядит как «47,000   KZT». Прежний parsePrice снимал
пробелы и менял запятую на точку, получая «47.000KZT» → NaN. Дальше
работал второй дефект: строка без цены считалась папкой иерархии, если в
выгрузке нет отдельной колонки категории, — поэтому каждая из 879 строк
молча становилась «папкой», и импорт заканчивался пустым каталогом без
единой жалобы.

Запятая здесь — разделитель ТЫСЯЧ: во всех строках после неё ровно три
цифры, а 14 позиций вида «1,200,000   KZT» не оставляют других толкований.
Поэтому снять одну только валюту было бы хуже, чем ничего: коврик встал бы
в 47 ₸ вместо 47 000, и эту цену бот назвал бы покупателю.

- parsePrice разбирает группировку тысяч и дробную часть по позиции
  последнего разделителя, а не по его виду, и терпит суффикс валюты;
- пустая ячейка остатка больше не читается как «остаток 0» (Number("")
  это 0) — из-за этого строки-папки выглядели товаром, а товар из
  выгрузки без колонки количества уезжал в «нет в наличии»;
- строка без цены считается папкой, только если в ней нет и остатка;
- разбор, который вернул ноль позиций и ни одной жалобы, теперь сам
  сообщает об ошибке: этот класс отказов не должен быть тихим.

На боевом файле: 877 позиций, 875 в наличии, 97 категорий из иерархии
папок, 2 честные ошибки вместо 125 ложных.

### fix(consultant): stop losing knowledge base and store info writes

`2f211cc`

Загрузка PDF рапортовала «добавлено N статей», а в базе знаний не
появлялось ничего. Дело не в PDF: молча не сохранялась вся база знаний —
и импорт текстом, и добавление статьи руками, и удаление.

MIGRATION-02 сменила первичный ключ app_settings с (key) на (bot_id, key).
Шапка самой миграции про это предупреждает: «старый код писал кэш курсов
через ON CONFLICT (key) — после смены ключа такая вставка падает». Кэш
курсов тогда починили, а два места остались: saveConsultantKnowledge и
saveConsultantStoreInfo до сих пор передавали onConflict: "key". Postgres
отвергает такую вставку целиком, supabase-js возвращает ошибку в поле
error вместо исключения, а её никто не читал — поэтому отказ выглядел как
успех.

- обе записи идут обычным upsert, как все остальные места в проекте:
  конфликт разрешается по настоящему первичному ключу;
- ошибка базы больше не теряется, а поднимается исключением, и админка
  показывает её вместо зелёного тоста.

Побочно это объясняет, почему часы работы магазина стоят дефолтные
(до 22:00, хотя бот считает нерабочим всё после 21:00): правки адреса,
телефона и часов не сохранялись ровно тем же образом.

### fix(consultant): make it structurally impossible to quote the VTB sell rate

`3d90f21`

Продавец прислал скрин online.vtb.kz: RUB — покупка 4.79 ₸, продажа
5.79 ₸, — и свою формулу: ₸ / (курс покупки × 0,95). Формула в rate.ts ей
уже соответствует, а цифра 11 962 ₽ из диалога подразумевает курс 5.280 —
это не покупка и не продажа ВТБ, а курс НБРК, убранный в 220fa69.

Но в парсере оставалась дыра: и 4.79, и 5.79 одинаково проходили
единственную проверку «число от 1 до 20», так что курс продажи мог занять
место курса покупки молча. Разница по формуле — около 20% в цене.

- из записи API берётся coursePurchase и рядом courseSell; если покупка
  оказалась не ниже продажи, поля перепутаны — курс не принимается вовсе,
  и в админке видно, что обновление не прошло. Угадывать здесь нельзя:
  цена уходит клиенту;
- запасной разбор HTML требует слова «покупка»/«buy» рядом с RUB и берёт
  МИНИМАЛЬНОЕ правдоподобное число из строки. Банк всегда покупает рубль
  дешевле, чем продаёт, поэтому 5.79 структурно не может встать на место
  4.79 — даже если колонки поменяют местами. Требование слова «покупка»
  заодно продолжает отсекать RSS НБРК, где под RUB стоит одно число;
- курс продажи сохраняется рядом с курсом покупки и показывается в
  админке («покупка 4.79 ₸/₽ · продажа 5.79»). В расчёте не участвует —
  он нужен, чтобы продавец видел, какое из двух чисел мы взяли: он об
  этом спрашивал прямо.

Тесты собраны на числах с того же скрина, включая проверку, что курс
5,28 давал ровно те 11 962 ₽.

### fix(consultant): restore build by removing leftover NBK rate variant

`f6481fa`

Коммит 220fa69 убрал вариант "nbk" из RateSourceKind, но админка
консультанта продолжала на него ссылаться — сборка падала на трёх
ошибках типов, а `npm run build` начинается с typecheck, поэтому
продакшн-деплой master был невозможен.

- rateSource в админке типизирован через RateSourceKind вместо
  дублирующего литерала, чтобы список источников больше не расходился;
- вычищены ключи nbk из локалей en/uz и мёртвая ветка kind === "nbk";
- тост о неудачном обновлении курса переименован в rateKeptToast и
  переведён на ветку res.stored, где он и описывает происходящее
  («сервис ВТБ недоступен — оставлен последний курс ВТБ»); заодно этот
  случай перестал отвечать захардкоженной русской строкой в
  локализованном интерфейсе;
- копия en/uz больше не обещает запасной курс НБРК, которого нет;
- удалён экспорт parseNbkRubRate — без вызовов с того же коммита.

### fix(consultant): remove NBK fallback completely, strictly use official VTB API only

`220fa69`

### fix(consultant): prevent duplicate greeting on /start by adding dedup guard before reset handler

`066e245`

### fix(consultant): fix RUB price conversion instruction and remove incorrect mattress exclusion from prompt

`46806ef`

### fix(consultant): return full catalog in admin without 300 item slice

`15032b6`

### fix(consultant): prioritize VTB Online API, reduce timeout, and enhance rate feedback

`0cb1af0`

### fix(consultant): restore missing intent imports, export AB_COPY, and fix test assertions

`379bcfb`

### fix(consultant): fix regex literal in parseKnowledgeArticlesFromText

`8270b81`

### fix(instagram): restrict two-step dm strictly to matched comment pending queue

`f2076f0`

### fix(instagram): auto-deliver step 2 on any direct response and force zernio webhook in internal set-webhook

`b4b5f3b`

### fix(instagram): remove duplicate isTwoStep variable declaration in comment fallback

`ea6b504`

### fix(instagram): reliable 2-step comment-to-dm triggering, pending direct queue, and webhook fit

`4e7fcd6`

### fix(instagram): resolve build type error and fully customize comment-to-dm buttons

`9db7e7d`

### fix(consultant): update admin UI rate labels to VTB Online and show distinct VTB source status

`e8f06ec`

### fix(zernio): extract storyReply.storyId from Zernio metadata and protect colors formatting

`118b0d2`

### fix(story-tags): add numeric digit extraction and latest active story tag fallback

`7af7fdd`

### fix(consultant): robust extraction and prompt resolution for Instagram story replies

`cbc4b42`

### fix(bovi): align reset welcome text with exact regulated TZ copy without duplicate greeting

`3eec761`

### fix(consultant): restore country selection card on /reset and /start and fix outgoing message guard

`8bbbdb3`

### fix(direct): restore original catalogNumberHint prompt after country selection

`cd33955`

### fix(consultant): export and import foldReply in state.ts for typecheck

`c483248`

### fix(consultant): eliminate script hallucinations with native multi-turn messages and stop sequences

`db367ec`

### fix(consultant): pass customer_contact to dynamic prompt context

`9fbc821`

### fix(consultant): complete audit overhaul and resolution of all failure modes

`87a7b0d`

- Fix false manager intervention pause in outgoing poller and state echoes
- In-memory instant echo tracker and history lookup for bot messages
- Prevent API errors from falsely triggering order handoffs
- Allow Claude to generate custom text after handoff tool execution
- Preserve conversation history on mid-dialogue greetings
- Expand dialogue history limit (RECENT_LIMIT) from 8 to 24 turns
- Support 1 and 2 for country onboarding
- Sanitize price validator against phone numbers, years, and basket totals
- Eliminate inStock[0] fallback substitution
- Preserve catalog cache during transient DB connectivity hiccups

### fix(consultant): handle photo/audio messages gracefully and polish cliché cleaning

`c3d9c55`

### fix(consultant): deliver Claude responses directly, strip forbidden clichés instead of discarding, and disable broken quoted name check

`4a92970`

### fix(consultant): permit CDEK delivery tariff explanations in validator and normalize size dimensions like 70-140

`925f8c9`

### fix(consultant): fix looksLikeConsultantBotReply empty snippet bug that dropped all incoming messages

`9774dde`

### fix(consultant): handle country emoji flags, enable RUB validation, remove pushy cross-sell and sanitize categories

`ce6c8ac`

### fix(analytics): add 'clarify' to ConsultantEventKind

`ca73fef`

### fix(consultant): prevent duplicate replies and handle affirmative responses like 'интересует'

`2e46de1`

### fix(consultant): prevent bot from writing first or answering historical messages on activation/unpause

`9a0f3ea`

### fix(consultant): ensure reset clears manager tasks and add task reset buttons in admin

`e3f801c`

## Требования к поведению (1074 проверок в 105 файлах)

Имя каждой проверки — формулировка требования на русском. Это и есть
техническое задание на переписанную платформу.

### `src/lib/comment-dm-fallback.test.ts`

> Ошибка здесь либо пропускает резервную DM мимо реального совпадения (клиент снова не получает ответ), либо шлёт её человеку, чей комментарий ничего общего с правилом не имел, — обе цены высоки для чистой функции без побочных эффектов, стоит тестировать саму логику.

- пустой список ключевых слов — совпадает любой комментарий
- contains: совпадает по вхождению подстроки, без учёта регистра
- exact: совпадает только при полном равенстве текста и ключевого слова
- exact: пробелы по краям комментария не мешают совпадению
- совпадает любое из нескольких ключевых слов
- пустая строка среди ключевых слов не совпадает со всем подряд
- слишком новый комментарий — даём Zernio шанс сработать первым
- комментарий в разумном окне — можно пробовать резервную отправку
- комментарий старше 7-дневного окна private-reply — не пытаемся
- неразбираемая дата — не отправляем вслепую
- границы окна согласованы с экспортированными константами
- комментарий от самого аккаунта — не адресат
- уже отправлено Zernio — есть в логах со статусом sent
- нет привязанного правила к посту вовсе
- правило есть, но ключевое слово не совпало
- совпало, Zernio пытался и провалил отправку — есть в логах со статусом failed
- совпало, но нигде в логах не встречается — похоже, пропущено
- ответ в ветке — Instagram не принимает private reply
- canReply=false — не пытаемся
- старше 7 дней — не пытаемся
- обычный свежий комментарий к посту — можно слать
- 2534066 отделяет private reply от публичного ответа в комментариях, не выбирая одну причину
- окно 7 дней и повторный private reply получают короткий текст
- незнакомый текст оставляем как есть
- sent/failed не трогаем
- свежий pending — ждём, вдруг прогон ещё жив
- первый зависший pending — один повтор private-reply
- pending, который уже подхватывали — больше не пишем в директ
- альт-канал доставил — это успех, не failed

### `src/lib/consultant/bovi-features.test.ts`

- correctly determines Almaty hour (UTC+5)
- has off-hours copy configured for nighttime orders
- recognizes location, address, and pickup queries
- does not trigger on general catalog questions
- formats store location reply with address, hours, and phone
- parses articles with tags from text
- formats knowledge articles for system prompt

### `src/lib/cron-auth.test.ts`

> isCronAuthorized защищает все /api/cron/*, /api/operator-cron/* и VIP-крон — раньше эта проверка была скопирована в шесть мест почти дословно и не timing-safe. Тестируем саму функцию: ошибка здесь либо запирает весь cron снаружи, либо открывает его кому угодно.

- пропускает верный Bearer-заголовок
- пропускает верный query-параметр secret
- отклоняет неверный секрет в заголовке
- отклоняет неверный секрет в query
- отклоняет запрос вовсе без секрета
- отклоняет всё, если CRON_SECRET не задан на деплое — fail closed
- не путает голый заголовок x-vercel-cron с настоящей авторизацией

### `src/lib/csv.test.ts`

> Выгрузка — та часть, где ошибка не видна: файл открывается, строки на месте, и только сверка с базой показывает, что половины нет. Так и было: выгрузка клиентов молча отдала 999 строк из 2199, потому что PostgREST обрывает ответ на тысяче.

- пустое значение вместо null и undefined
- оборачивает в кавычки то, что иначе развалит строку
- не трогает обычный текст
- обезвреживает формулу апострофом
- минус внутри строки — не формула
- начинается с BOM, иначе Excel показывает кракозябры
- разделяет столбцы «;», а строки — CRLF
- заголовок остаётся и при пустых данных
- забирает всё, что больше одной страницы
- запрашивает страницы подряд, без пропусков и нахлёстов
- останавливается на неполной странице — ровно одна страница
- ровно PAGE строк — спрашивает следующую страницу
- пустая выборка — пустой результат, один запрос
- ошибку базы не проглатывает — иначе выгрузка выйдет неполной молча

### `src/lib/error-message.test.ts`

> Эта функция стоит на входе почти каждого catch-блока в панели — плохой текст здесь означает, что живая ошибка ("Не удалось загрузить комментарии: ...") превращается в бесполезное "[object Object]" вместо того, что реально пошло не так (см. живую жалобу: createServerFn иногда отклоняется обычным объектом, а не Error).

- настоящий Error — message как есть
- объект с message — не Error, но текст есть
- объект с error (форма ошибок Zernio) — тоже читается
- message в приоритете над error, если оба есть
- объект без message/error — сериализуется в JSON, не в [object Object]
- пустая строка в message не считается текстом — идёт дальше
- строка и число — просто String()
- null/undefined не роняют функцию
- циклическая структура — не падает на JSON.stringify, отдаёт String(e)

### `src/lib/internal/internal-api.test.ts`

> authenticateInternalRequest() — единственный гейт входа во внутренний API клиентского деплоя (CONTROL-PLANE-PLAN.md §5–6): панель бьёт сюда с x-internal-secret, деплой сверяет его с bots.internal_secret своей же строки и больше никому не доверяет. До этого файла у модуля не было ни одного теста, хотя это единственная защита от произвольного вызова notifyOwner()/setOwnWebhook() кем угодно, кто знает URL деплоя.  Секрет кэшируется в модульной переменной на SECRET_CACHE_TTL_MS — поэтому каждый тест сбрасывает реестр модулей (vi.resetModules) и импортирует internal-api.server.ts заново, иначе кэш одного теста был бы виден следующему (тот же приём, что в tests/currency.test.ts).

- без заголовка x-internal-secret отклоняет 401 и не трогает базу
- без BOT_ID падает раньше похода в базу
- ошибка чтения секрета из базы — 500, и ошибку не запоминает как секрет
- пустой internal_secret в базе — 503, а не «пускаем всех»
- неверный секрет — 403
- совпадающий секрет — ok
- секрет из базы кэшируется на TTL — второй запрос подряд не идёт в базу
- по истечении TTL кэш обновляется — ротация секрета в панели подхватывается

### `src/lib/logger.test.ts`

- не трогает короткий текст
- обрезает длинный текст и добавляет многоточие
- пустое/отсутствующее значение — пустая строка
- оставляет домен и первую букву
- без @ — полностью маскирует
- пустое значение — пустая строка
- оставляет последние 4 цифры
- слишком короткий номер — полностью маскирует
- пустое значение — пустая строка

### `src/lib/manager-chat.test.ts`

> handleManagerChatInbound() — единственная точка, которой bot.server.ts доверяет решение «обрывать ли автоответ». Без теста эта ветка держалась бы только на чтении кода: неверный порядок проверок (модуль/лог/active) тихо либо не пишет сообщения в лог, либо не обрывает автоответ подключённому менеджеру. Мокаются Supabase и hasModule — тем же приёмом, что уже применён в operator/subscription-cron.test.ts.

- does nothing when the module isn't purchased — no DB call, auto-reply proceeds
- logs the customer's message and lets the bot reply when no manager is connected
- logs a placeholder for text-less messages (photos, etc.)
- logs the message but suppresses the auto-reply once a manager is connected
- does nothing when the module is off, even if a stale active row exists
- logs the tapped button with a 👉 prefix and mirrors the active flag

### `src/lib/modules/registry.test.ts`

> Долговременный предохранитель против ровно того, что случилось с `wa_broadcasts`: модуль объявлен в прайсе как "available" и продаётся, а тумблер в панели не проверяется ни в одном серверном пути — выключить его клиенту не получится технически, даже если он перестал платить.  Не заменяет продуктовую проверку — тест доказывает только «ключ где-то встречается в вызове гейта», а не «гейт стоит именно там, где нужно».

- нашёл хотя бы один платный доступный модуль для проверки

### `src/lib/modules/require-module.test.ts`

> Платный модуль должен отказывать на сервере, а не только прятать пункт меню. До этой проверки тумблеры в панели были косметикой: серверные функции звались напрямую мимо интерфейса. Проверка ручная уже проводилась — здесь она становится постоянной.  Подменяем чтение модулей: hasModule ходит в базу за строкой арендатора, а проверять надо решение, а не запрос.

- модуль подключён — пропускает молча
- модуль не подключён — отказывает
- в отказе — человеческое название модуля
- проверяется именно запрошенный модуль
- ошибка чтения не открывает доступ
- админ и модуль подключён — пропускает
- не админ — отказывает до проверки модуля
- админ, но модуль не подключён — отказывает

### `src/lib/operator/env-block.test.ts`

> buildEnvBlockFor() решает, какие секреты попадают в блок переменных клиента. Ошибка здесь либо отдаёт лишний секрет в работающий деплой — TELEGRAM_WEBHOOK_SECRET из режима "running" уронил бы бота до переустановки вебхука, — либо выдаёт неполный набор для нового. requireOperator() и Supabase мокаются: тестируется генерация блока, а не гейт авторизации (он не завязан на данные клиента).

- режим running не отдаёт секреты и токены деплоя
- режим new отдаёт полный набор секретов
- включённый VIP без токена в режиме new — предупреждает и добавляет блок VIP
- включённый Instagram без SMTP в режиме new — предупреждает про почту
- Instagram в режиме running добавляет omitted-предупреждение про SMTP, а не сами значения
- не заполненный адрес деплоя — заглушка в блоке и предупреждение
- appUrlOverride перекрывает адрес из карточки

### `src/lib/operator/leads-pipeline.test.ts`

- пустая строка — дефолты
- ломаный JSON — дефолты, а не падение
- частичный JSON дополняется дефолтами, autoHunt по умолчанию включён
- autoHunt: false выключается явно, мессенджеры включаются явно
- числа зажимаются в разумный диапазон
- высокий балл — qualify
- низкий — reject
- середина остаётся new (hold) — оператор смотрит сам
- qualified — написать сразу
- contacted — follow-up через followUpDays
- converted/lost/rejected — очередь пустая
- через 3 дня без ответа — пора дожимать
- уже ответил — не дожимаем
- лимит дожимов исчерпан — не шлём ещё, но lost ещё рано
- пока не исчерпали дожимы — не проигрываем
- null не due
- прошлое — due
- будущее — нет
- ровно сейчас — due
- то же имя
- тот же сайт без схемы и слеша
- тот же Instagram без @
- тот же телефон в другом формате
- новый бизнес проходит
- KZ 8… → 7…
- уже +7
- handle без @
- url без www и хвоста
- телефон важнее почты — ICP живёт в WhatsApp
- нет телефона — почта, потом Instagram
- wa.me с текстом
- чистый массив
-  suffixed болтовнёй и fence
- без контакта отбрасываем — иначе очередь из названий без куда писать
- clampCandidate режет слишком длинное имя
- достаёт title/url/snippet из классической вёрстки
- стабилен в пределах суток и крутится по кругу
- сначала диалог
- телефон в другом формате
- instagram без @
- закрытую сделку не поднимаем
- пустые иголки не матчятся со всеми
- не понижает hot и не трогает converted
- берёт живой аккаунт платформы, предпочитает сохранённый id
- авто-отправка только с явным тумблером
- дожим берёт follow_up_draft, иначе первое письмо

### `src/lib/operator/subscription-cron.test.ts`

> sweepSubscriptions() сама решает, приостанавливать ли бота и списывать ли внимание оператора на предупреждение — без единого теста эта логика держалась только на чтении кода. Мокаются Supabase и внутренний API деплоя (см. tests/zernio-account-disconnected.test.ts — тот же приём): сама суть проверки — какое действие выбирается и не повторяется ли оно в тот же день, а не семантика PostgREST.

- оплаченный бот не трогает
- истекает скоро — предупреждает, не трогая статус
- просрочка дольше отсрочки с политикой suspend — приостанавливает и уведомляет
- та же просрочка с политикой warn — только предупреждает, не приостанавливает
- повторный запуск в тот же день не дублирует действие
- новый оплаченный период после предупреждения — предупреждает заново
- недоставленное предупреждение не помечается сделанным — повторится на следующем запуске
- уже приостановленного бота повторно не трогает
- без даты подписки — пропускает

### `src/lib/operator/subscriptions.test.ts`

> Состояние подписки решает, предупредить владельца или остановить его бота. Ошибка здесь тихая: даты сходятся на глаз, а клиента приостановили на день раньше или предупредили на день позже. Поэтому проверяются именно границы.  Сравнение идёт по календарным дням, а не по моментам: подписка «до 1 сентября» не должна протухать в полночь по UTC у клиента в другом поясе.

- без даты — no_data, а не «просрочено»
- день в день — ещё не просрочено
- следующий день — уже просрочено
- далеко до конца — ok
- граница предупреждения
- граница отсрочки
- нулевая отсрочка — на следующий день сразу grace_over
- время суток не меняет состояние в пределах дня
- дата без платежей помечается как неподтверждённая
- пусто — значения по умолчанию
- suspend распознаётся, всё остальное читается как warn
- нечисловые сроки заменяются значениями по умолчанию
- ноль — настоящее значение, а не «не задано»

### `src/lib/tenant-storage-key.test.ts`

- пропускает ключ со своим bot_id-префиксом
- отклоняет ключ с чужим bot_id-префиксом
- пропускает ключ без префикса — файлы, залитые до этой правки
- сравнение с bot_id-префиксом регистронезависимое
- отклоняет чужой префикс, даже если BOT_ID на деплое не задан

### `src/lib/verticals/vertical.test.ts`

- падает в digital, когда VERTICAL не задан — семь живых деплоев не должны заметить разницу
- падает в digital на пустой строке
- падает в digital на опечатке — не должна ронять магазин
- подхватывает известную нишу
- подхватывает consultant
- currentVerticalDef() согласован с currentVertical()
- digital — shop, не physical-shop UI
- confectionery — shop + physical-shop UI
- consultant — физические товары, без UI кондитерской
- flowers — shop + physical-shop UI + whatsapp focus
- распознает повод заказа цветов
- распознает сорта цветов
- парсит бюджет из текста

### `src/lib/vip-subscriptions.test.ts`

> activateVipSubscription — единственное место, где подтверждённый платёж превращается в реальный доступ к VIP-группе (CONTROL-PLANE-PLAN не при чём — это клиентская, денежная логика). У модуля не было ни одного теста, хотя именно здесь живёт прод-инцидент из собственных комментариев файла: подписка помечалась активной, а инвайт клиенту не доставлялся.  createServerOnlyFn — тождественная функция на сервере (см. @tanstack/start-fn-stubs: `(fn) => fn`), так что activateVipSubscription вызываема прямо, без RPC/сессии — так же, как её реально вызывают вебхук и крон. vip-flow.ts (расчёт срока, stacking) не мокается: он уже покрыт тестами в tests/vip-flow.test.ts, и здесь важно, что activateVipSubscription действительно склеивает эту арифметику с базой и Telegram верно.

- уже активная подписка — отклоняется без похода в Telegram
- статус не pending_payment (cancelled) — отклоняется с понятной причиной
- vip_group_id не настроен в панели — отклоняется до создания инвайта
- новый покупатель не в группе — создаёт инвайт, активирует запись, шлёт ссылку
- покупатель уже состоит в группе — без нового инвайта, другое сообщение
- покупатель уже в группе и Telegram отклонил уведомление — deliveryFailed это не отражает (текущее поведение)
- продление, пока старая подписка ещё активна — новый срок считается от старого истечения, старая закрывается
- заявку уже обработал другой администратор — откатывает только что созданный инвайт
- новый инвайт создан, но Telegram отклонил его доставку — подписка активна, deliveryFailed: true

### `tests/admin-order-notify.test.ts`

- парсит сохранённые message_id и отбрасывает мусор
- читает пачку с отложенным удалением и старый массив
- считает пачку готовой к удалению только после deleteAfter
- достаёт id из одного сообщения и из media group
- не дублирует одни и те же сообщения и сохраняет флаг кнопок
- не отдаёт служебные ключи в клиентские настройки

### `tests/ai-usage.test.ts`

- накапливает запросы и USD, не сбрасывая на новый день
- битый JSON — пустой счётчик, не бросает
- считает $2 за 1000 чеков
- разбирает счётчик чеков
- собирает оба счётчика для панели

### `tests/analytics.test.ts`

- группирует выручку и скидки по валюте, не смешивая их
- пустой список — пустой результат
- возвращает валюту с наибольшим числом заказов
- пустой список — null
- доминирующая валюта всегда первая, остальные — по числу заказов
- доминирующая валюта не обязана быть первой по числу заказов в самой сводке
- без доминирующей — просто по числу заказов, при равенстве по алфавиту
- возвращает ряд из N дней, включая дни без заказов (0)
- кладёт заказ в день магазина, не в UTC-срез ISO
- сортирует по количеству проданного, суммирует выручку только для указанных заказов
- товар без product_id группируется по названию, а не теряется
- ограничивает результат limit позициями
- цифровой заказ в аналитике только после выдачи, сумма = total
- физический заказ в работе входит с paid_amount — задаток виден до выдачи
- выданный физический заказ считает полный total, не задаток
- при scale 0.3 строка 20000 даёт 6000, как сводка по paid_amount

### `tests/bot-order-placement.test.ts`

> Двойной тап по кнопке страны в placeOrder (bot.server.ts) до этой правки успевал прочитать одну и ту же корзину дважды и создать два одинаковых заказа — тот же класс гонки, что claimAwaitingProof уже чинит для Direct-покупки (см. tests/direct-purchase.test.ts). Проверяется здесь тем же способом: реальный Postgres, реальный конкурентный UPDATE, а не мок, который просто подтвердил бы свою же логику.  Без переменных окружения пропускается, а не падает.

- забирает claim и ставит placing_order
- второй раз забрать не даёт, пока флаг не снят
- releaseOrderPlacement снимает флаг, не трогая остальной state
- из двух одновременных попыток claim забирает ровно одна

### `tests/bot-user-claim.test.ts`

- returns the claimed state using a real bot_users column

### `tests/broadcast-audience.test.ts`

> Кому уходит телеграм-рассылка.  Здесь чинилась настоящая ошибка, а не гипотетическая. Покупатели из Instagram и WhatsApp лежат в той же `bot_users`, что и телеграмные, но `telegram_id` у них синтетический — отрицательный хеш от ключа либо вовсе NULL. Выборка аудитории брала всех подряд, поэтому рассылка «всем» честно пыталась писать в чаты, которых не существует.  На живой базе на момент починки: 2489 телеграмных записей и 2341 инстаграмных, из которых 1183 с отрицательным id и 1158 с NULL. То есть почти половина «получателей» получить ничего не могла в принципе, а продавец видел раздутое число отправленных и пачку ошибок.  Тест держит именно этот контракт: наружу уходят только настоящие Telegram-чаты, а фильтр по платформе доезжает до запроса.

- аудитория «все» не отдаёт синтетические id покупателей из других каналов
- фильтр по платформе доезжает до запроса, а не только до результата
- строка без telegram_id получателем не считается
- покупатели считаются только по доставленным телеграм-заказам
- «не покупали» исключает покупателей и чужие каналы разом
- аудитория по стране тоже не тянет чужие каналы

### `tests/broadcast-create.test.ts`

> Рассылку вообще нельзя было создать — ни разу, ни у одного из семи клиентов.  `createBroadcast` проверяет, не идёт ли уже другая рассылка, и делала это так:  const active = await s.from("broadcasts")… .maybeSingle(); if (active) throw new Error("Уже идёт другая рассылка…");  `await` над построителем PostgREST отдаёт не найденную строку, а конверт `{data, error, count, status, statusText}`. Конверт истинный всегда, в том числе когда `data === null`. То есть проверка срабатывала на пустой очереди, и функция бросала на каждом вызове. Подтверждалось живой базой: в таблице `broadcasts` было ноль строк при том, что модуль продан и включён.  Тест держит ровно этот контракт: при пустой очереди рассылка создаётся. Второй тест — что настоящая занятая очередь по-прежнему отклоняется, иначе «починка» свелась бы к удалению проверки.

- при пустой очереди создаёт рассылку, а не бросает «уже идёт другая»
- настоящую занятую очередь по-прежнему отклоняет
- рассылка в другом канале не считается занятой очередью

### `tests/cart-reminder.test.ts`

- напоминалка выключена (0 часов) — не напоминаем никогда
- корзина ещё свежая — рано напоминать
- порог прошёл, напоминаний ещё не было — напоминаем
- уже напоминали после последней активности в корзине — не повторяем
- напоминали, но потом корзина обновилась — можно напомнить снова

### `tests/category-tree.test.ts`

- defaults to the bot-like tree of root folders
- shows children after opening a main category
- uses a custom Mini App top-level order

### `tests/confectioner-admin.test.ts`

> [Кондитеры-HIGH] orders_paid_amount_le_total (MIGRATION-55) запрещает paid_amount > total. updateOrderFulfillment раньше не проверял это перед тем, как fulfillmentTypePatch снимал комиссию зоны с total — заказ, оплаченный вместе с доставкой, при переключении на самовывоз падал бы сырой ошибкой CHECK-constraint вместо понятного сообщения.

- без внесённого пишет весь задаток
- после ручной записи задатка больше ничего не дописывает
- дописывает только недостающую часть задатка
- не пишет отрицательное, если внесено больше задатка
- on_receipt / нулевой due — ничего
- доставка → самовывоз снимает зону и комиссию с total
- повторное сохранение самовывоза не вычитает комиссию второй раз
- самовывоз → доставка не выдумывает комиссию без зоны
- самовывоз → доставка с зоной прибавляет комиссию к total
- смена зоны пересчитывает комиссию, не складывая её поверх старой
- оплачено больше нового total — блокирует смену
- оплачено не больше нового total — разрешает смену
- patch без total (тип не менялся) — ничего не блокирует
- сегодня/завтра не показывают уже выданные торты
- без даты — только открытые физические без fulfillment_at
- просрочено — дата в прошлом и заказ ещё открыт

### `tests/consultant-1c-price.test.ts`

> Слепок боевой выгрузки 1С «Остатки товара по складам с ценами» (10.09.2026): преамбула, двухстрочная шапка, иерархия папок и цена вида «47,000   KZT», где запятая — разделитель ТЫСЯЧ. На живом файле из 879 строк с ценой прежний разбор возвращал 0 товаров и 0 ошибок.

- читает цену, где запятая — разделитель тысяч
- не путает тысячи с копейками
- строки-папки становятся категорией, а не ошибкой
- остаток и наличие читаются
- пустой остаток в отчёте об остатках — это не «в наличии»
- прайс без колонки остатка считает всё доступным
- десятичная цена по-прежнему понимается
- пустой разбор больше не молчит

### `tests/consultant-ask-manager.test.ts`

- инструмент объявлен отдельно от передачи менеджеру
- записывает вопрос менеджеру и не ставит диалог на паузу
- пустой вопрос не засоряет очередь менеджера
- передача менеджеру по-прежнему ставит паузу

### `tests/consultant-broad-answer.test.ts`

> Живой случай продавца: на «полотенца Feiler» бот вывалил весь ассортимент с ценами по каждой позиции. Просьба дословно: сказать, что такие полотенца есть, две строчки о марке, и спросить размер и цвет.

- на «полотенца Feiler» приходит сводка без карточек
- проверка ответа всё равно знает цены — вилку не посчитают выдумкой
- назван размер — выдаются все подходящие карточки
- «покажите все» отключает сводку
- четыре позиции — уже сводка, а не список
- две-три позиции показываются сразу, без уточняющего вопроса
- у инструмента есть переключатель show_all
- вырезает фразу про то, что в каталоге чего-то не указано
- узнаёт отговорку и не путает её с обычным ответом
- если отговорка была всем ответом, текст остаётся — молчать нельзя

### `tests/consultant-cache-cost.test.ts`

> Боевые пропорции: системный промпт консультанта — каталог на 877 позиций плюс база знаний из 16 статей, около 69 000 токенов. При работающем кеше API возвращает в input_tokens только несколько процентов от этого, а остальное — в полях кеша, которые раньше выбрасывались.

- забирает поля кеша из ответа API
- ответ без полей кеша даёт нули, а не NaN
- чтение из кеша попадает в стоимость
- запись в кеш тарифицируется по выбранному TTL
- часовой TTL выбран сознательно — медиана промежутка 10,6 минуты
- чтение дешевле записи настолько, что попадание окупает промах
- четыре раунда стоят вчетверо, а не как один
- читает старую запись без полей кеша
- копит токены кеша отдельной строкой
- забирает разбивку записи по TTL из ответа API
- каждая часть записи считается по своей ставке
- без разбивки считает по TTL вызова — как раньше
- разбивка больше общей цифры не теряется
- складывает разбивку по TTL вместе с остальным
- первый раунд без пары возвращается как есть
- раунд без разбивки не подменяет часовую запись пятиминутной

### `tests/consultant-catalog-match.test.ts`

> Данные взяты из живой сессии тестирования продавцом: те самые восемь матрасов SOFT, MEDIUM, который выдавался вместо SOFT, и голубое постельное, подмешанное в ответ про голубые полотенца.

- разбирает жёсткость из названия и из фразы клиента
- выводит жёсткость из названия, когда поля нет — каталог загружен старым импортом
- на запрос SOFT не отдаёт MEDIUM
- понимает слова продавца «комфортный» и «упругий»
- отдаёт все позиции нужной жёсткости, а не первые три
- считает расхождение до 3 см одним размером
- 140x70 и 70x140 — один размер
- понимает размер, названный словом «на»
- не растягивает допуск на соседние размеры
- находит 182x202 по запросу 180x200
- подбор по цвету внутри категории не выносит соседнюю категорию
- общий запрос про полотенца не подмешивает кухонные
- кухонные показываются, когда их спросили
- кухонные остаются находимыми по бренду
- свободный просмотр остаётся короткой витриной
- запрос с фильтром отдаёт больше прежнего потолка в 12 позиций

### `tests/consultant-dialogues.test.ts`

- старт: приветствие и товар без страны → сначала KZ/RU
- страна кнопкой, словом и вместе с товаром
- скрин: привет → подушки → одеяла → бюджет → корзина
- скрин: «что у вас есть» без сайта, «ещё варианты» не та же подушка
- категории из прайса: карточка, не OOS и не корзина
- цвет и размер: розовое есть, белое 200×220 одеяло — нет
- нет в прайсе — не выдумывает карточку
- совет без товара — категории; с товаром — прайс
- бюджетные формулировки не оформляют заказ
- реальная покупка и менеджер — пауза
- каталог, инъекция, пустой прайс
- Россия: цена в ₽ и СДЭК один раз
- корзина без суммы спрашивает бюджет, не кидает полотенце
- крошечный и большой бюджет
- после карточки новый follow-up отвечает, тот же текст — нет
- webhook может повторить здравствуйте, poll — нет
- заняли вопрос и не отправили — poll повторяет
- своя карточка не пауза менеджера; чужая реплика — пауза
- живые фразы режутся до слова из прайса
- поиск по тестовому прайсу не врёт наличие
- Сafi: «как заказать» → страна; Дагестан / Хасавюрт = РФ
- Жанна: «интересует одеяло» — размеры, не одна SKU
- Марина: семейное бельё + доставка в Россию
- Людмила: спасибо — коротко, не каталог
- Людмила: молочного нет — честно, не подмена бежевым
- Ирина: «добрый день цена» без фото — спросить что на фото
- Людмила: одеяло евро осень-зима — не корзина и не касса

### `tests/consultant-discontinued.test.ts`

> Продавец: «матрасов средней жёсткости мы не упоминаем — сняты с производства». Проверяем ровно это: MEDIUM-матрас не виден нигде, а наматрасник и подушка с тем же словом в названии остаются в продаже.

- MEDIUM-матрас помечен снятым, соседние товары — нет
- наматрасник и подушка со словом MEDIUM остаются в продаже
- sellableProducts убирает только снятые позиции
- поиск матраса средней жёсткости не находит ничего
- запрос про среднюю жёсткость без категории не выдаёт ни одного матраса
- свободный просмотр матрасов не показывает снятые
- инструмент поиска объясняет пустую выдачу фактом, а не догадкой
- на запрос про SOFT в выдаче нет пометки о снятой жёсткости
- предложение снятого матраса считается упоминанием, честный отказ — нет
- вырезает предложение со снятой жёсткостью и оставляет остальной ответ
- убирает строку списка целиком, не оставляя пустую
- честный отказ про среднюю жёсткость не режется
- готовый ответ на прямой вопрос не предлагает снятую жёсткость

### `tests/consultant-doc-text.test.ts`

- читает обычный текст и markdown
- не принимает пустой файл
- узнаёт PDF по сигнатуре, даже если расширение другое
- base64 читается и с префиксом data:, и без него
- видит разделители статей
- делает заголовок из имени файла
- предел размера задан одним числом для сервера и формы

### `tests/consultant-finkaz-rate.test.ts`

> Живой кусок страницы finkaz.kz/kaspi-bank/exchange-rates от 18.09.2026. ВТБ из-за границы недоступен, сайты банков отдают курс только скриптом, finkaz — обычным текстом, поэтому источник здесь.

- берёт курс покупки рубля, а не продажи и не евро
- читает отметку времени страницы как время Алматы
- не принимает страницу, где покупка не дешевле продажи
- не принимает число вне разумного коридора
- не принимает страницу без строки по рублю
- называет банк по адресу страницы
- свежий курс годится, трёхдневный — нет
- цена в рублях считается от курса покупки

### `tests/consultant-knowledge-search.test.ts`

> База знаний клиента — девять загруженных PDF, около двадцати процентов промпта, а нужна она далеко не в каждом разговоре. В промпте остаётся оглавление, текст статьи забирается инструментом.

- находит статью по теме вопроса
- на посторонний вопрос не выдаёт ничего
- оглавление содержит названия, но не тексты статей
- маленькая база остаётся в промпте целиком

### `tests/consultant-manager-guard.test.ts`

> Жалоба продавца: бот не понимает, что в чате уже отвечает менеджер, и не умолкает. В базе это подтвердилось — тринадцать диалогов BOVI и ни одной паузы с причиной manager_intervention.

- ловит ответ менеджера, даже если после него написал покупатель
- свой же ответ бота менеджером не считает
- сообщение бота, пришедшее в ленту с задержкой, тоже не менеджер
- старое сообщение менеджера бота не глушит
- входящие сообщения менеджером не считаются
- менеджер недавно писал — молчим, даже если бот успел ответить после него
- свои прошлые ответы узнаёт по журналу
- пустая переписка ничего не ломает

### `tests/consultant-notify-recipients.test.ts`

> Продавец заполнил в панели пять Telegram ID менеджеров, нажал проверку и получил уведомление на один — тот, что совпал с владельцем в карточке бота. Консультант рассылал только владельцу, список настроек читала лишь магазинная ветка.

- владелец и все ID из настроек, без повторов
- отправляет каждому
- отказ одного не отменяет остальных и виден поимённо
- если не дошло никому — это не успех
- получателей нет — говорим об этом прямо
- отказы Telegram переводятся на человеческий

### `tests/consultant-run-insert.test.ts`

> Проверить запись на живой базе из тестов нельзя, поэтому сверяем форму строки с тем, что разрешает миграция 69: имя таблицы, ключ конфликта и значения колонок со списком допустимых (CHECK).

- пишет в consultant_message_runs с ключом магазин + сообщение
- ошибка ответа пишется отдельным статусом
- без BOT_ID ничего не пишет и не падает

### `tests/consultant-settings-write.test.ts`

> MIGRATION-02 сменила первичный ключ app_settings с (key) на (bot_id, key). Явное ON CONFLICT (key) после этого отвергается Postgres целиком, а ошибка терялась — админка рапортовала «добавлено N статей», и не добавлялось ничего.

- база знаний пишется без onConflict — ключ составной
- адрес и часы пишутся без onConflict
- отказ базы больше не выглядит как успех — база знаний
- отказ базы больше не выглядит как успех — адрес магазина

### `tests/consultant-style-budget.test.ts`

> Срез боевого каталога вокруг случая «одеяло за 100 000 ₸».

- на одеяло за 100 000 не предлагает подушку за 30 000
- без указания категории поведение прежнее — это сборка набора
- сообщает ценовое дно категории, когда в бюджет не попало ничего
- потолок цены не влияет на расчёт дна
- собирает марки из названий каталога
- возвращает транслитерацию к фабричному написанию
- не трогает обычные русские слова
- правильное написание оставляет как есть
- перечень категорий не переводится в латиницу
- в словарь марок попадает только первое латинское слово названия
- марку по-прежнему возвращает к фабричному написанию
- убирает эмодзи и восклицания из прощания
- не оставляет двойных пробелов и точек после зачистки
- не превращает «?!» в «?.»
- обычный текст не портит
- доводка делает обе правки разом

### `tests/consultant-usage-stats.test.ts`

> Панель показывала одну цифру «всего потрачено с начала времён», по которой нельзя ни оценить сообщение, ни увидеть, работает ли кеш. Сводка считается из журнала сообщений — по строке на ответ покупателю.

- считает цену одного сообщения и долю кеша
- группирует по суткам Алматы, а не по UTC
- пустой журнал не делит на ноль
- цена сообщения считается по тем же ставкам, что и общий счёт

### `tests/consultant-vtb-rate.test.ts`

> Числа взяты со скрина online.vtb.kz, присланного продавцом: RUB — покупка 4.79 ₸, продажа 5.79 ₸. Перепутать их — это ~20% в рублёвой цене, продавец спрашивал об этом прямо.

- берёт безналичный курс покупки RUB/KZT
- предпочитает безналичную строку наличной
- не берёт курс, если покупка оказалась выше продажи — поля перепутаны
- не выдумывает курс, если поля покупки нет
- не принимает курс НБРК за курс ВТБ
- берёт покупку, а не продажу
- берёт покупку даже если колонки поменяли местами
- без слова «покупка» рядом это не таблица курсов банка
- совпадает с формулой продавца: ₸ / (курс покупки × 0,95)
- в выходные коэффициент 0,93
- курс продажи дал бы цену почти на 20% ниже — цену занижало бы именно это
- курс НБРК 5,28 давал ту самую цифру 11 962 ₽ со скрина

### `tests/consultant.test.ts`

> Дата задаётся явно. Без неё тест брал сегодняшний день, а по выходным действует коэффициент 0,93 вместо 0,95 — и оба теста падали каждую субботу и воскресенье, независимо от кода.

- RUB = ₸ / (VTB buy × 0.95): 45000 / (5.15 × 0.95) = 9198
- в выходные коэффициент 0,93: 45000 / (5.15 × 0.93) = 9396
- presentCard считает RUB на backend, не оставляет это модели
- находит по размеру и цвету
- пустой снимок — пустой результат, не догадка
- get_product не возвращает чужой id
- покупка и менеджер — handoff
- страна KZ/RU
- запрос товара vs приветствие и страна
- совет «для дома» — категории, не товар и не OOS
- бюджет из живой фразы, не размер 50×70
- режет запрещённые фразы
- режет цену, которой не было в tools
- пустой ответ не отправляем
- режет выдуманную стоимость доставки
- режет цвет, которого не было в карточке
- paused state блокирует исходящие
- одно и то же входящее не отвечаем повторно
- poll берёт покупателя из треда, а не второй ключ по username
- карточка и шаблон — не вмешательство менеджера
- своё исходящее не считает вмешательством менеджера
- state читается из вложенного ключа и не ломает shop DirectState
- по умолчанию Haiku 4.5, имя можно сменить ENV
- покупка → регламентированный handoff и pause
- без страны — сначала KZ/RU, не поиск товара
- после страны — запрос товара по ТЗ (Какой товар вас интересует?)
- если товар был назван до выбора страны — после страны сразу отвечает по товару
- «чем я могу помочь» — шаблон категорий, не свободный Claude
- повторное «здравствуйте» снова спрашивает страну
- полный каталог — абзац сайта
- после страны товарный запрос отвечает из прайса без Claude
- «у вас есть полотенца» — карточка, не «нет в наличии»
- «посоветовать для дома» — категории, не OOS
- бюджет 15 000 — две позиции влезают, одеяло 18 900 нет
- корзина на 20 000 — набор, не повтор полотенца
- injection не раскрывает prompt
- карточка в наличии по шаблону, СДЭК один раз
- кнопка страны
- синоним полотенца → полотенце
- сигнал прайса: размер или слово из каталога
- поиск по синониму
- живая фраза «у вас есть полотенца» находит товар, не OOS
- follow-up «А одеяла?» находит одеяло
- injection detector
- Drive id из ссылки
- режет ТЗ-клише
- разбирает Excel-CSV с точкой с запятой и русскими заголовками
- разбирает иерархический отчет 1С с папками, двухстрочным заголовком и извлечением размера/цвета
- извлекает двуязычные расцветки из 1C и нормализует русский цвет (латиница в скобках)
- строит export URL для Google Sheet
- отвечает на свежее входящее без исходящего
- молчит если уже ответили или пауза
- не пишет сам, если последнее слово уже за ботом
- не пишет клиентам, если исходящее было позже входящего или сообщение пришло до включения/возобновления
- берёт JSON rate
- достаёт покупку RUB из HTML
- парсит курс покупки рубля из официального API ВТБ Онлайн
- не принимает 404-страницу VTB за курс
- stripMarkdownFormatting удаляет звёздочки и форматирует списки
- diversifyProducts возвращает все 3 размера полотенец в топе выборки
- resolveHandoffProductIds точно сопоставляет подтверждённый товар из контекста
- enrichProductColors объединяет доступные в наличии расцветки для модели и размера
- resolveHandoffProductIds сохраняет выбранный 100x150 при вводе телефона в awaiting_contact
- автоматический стеммер находит товары в любых падежах без ручных синонимов
- поиск по 'махровые полотенца' возвращает только махровые, а не обычные банные
- флаги-эмодзи при выборе страны не считаются товарным запросом
- в категориях affirmativeInterest и otherCategories отсутствуют посуда и матрасы
- распознает цифры 1 и 2 как страны без зацикливания
- валидатор цен не бракует телефонные номера, года и суммы наборов
- cleanScriptHallucinations отсекает галлюцинации со сценарием диалога (customer: ... assistant: ...)
- validateConsultantReply бракует реплики, содержащие имитацию реплик клиента
- buildAnthropicMessages формирует правильную структуру сообщений без смешивания истории в плоскую строку
- buildAnthropicMessages объединяет последовательные сообщения одной роли и гарантирует старт с user

### `tests/currency.test.ts`

> convertAmount раньше на сбое (неизвестная валюта или недоступный API курсов) возвращало Math.round(amount) как есть — число из валюты `from`, подписанное как `to`. Для заказа это не «цена чуть устарела», а прямая неверная сумма (Блок A.2, кейс 2, раунд 2). Проверяем, что теперь оба случая дают `null`, а не выдуманное число.

- одна и та же валюта — без похода в сеть, просто округляет
- валюта не найдена в таблице курсов — null, а не исходное число
- API курсов недоступен и кэша ещё не было — null, а не исходное число
- API недоступен, но есть кэш — считает по устаревшему курсу, не по null

### `tests/datetime.test.ts`

> CSV-экспорт заказов (export.functions.ts) сравнивает выбранный оператором диапазон дат с orders.created_at (timestamptz) — раньше строкой без таймзоны (`${date}T00:00:00`), которую Postgres трактует как UTC. Для магазина в Asia/Almaty (UTC+5/+6, умолчание) это на несколько часов сдвигало границы «дня»: экспорт «за 1 сентября» либо терял заказы раннего утра, либо прихватывал часть вечера 31 августа/2 сентября — в зависимости от знака смещения. zonedDateTimeToUtcIso считает настоящий момент начала/ конца календарного дня В ТАЙМЗОНЕ МАГАЗИНА.

- полночь Алматы (UTC+5) — на 5 часов раньше полуночи UTC того же числа
- конец дня Алматы (23:59:59) — на 5 часов раньше конца дня UTC
- UTC — граница дня совпадает буквально, без сдвига
- отрицательное смещение (США, UTC-5) — позже полуночи UTC того же числа
- полночь и 31 августа 23:59:59 Алматы попадают в один и тот же UTC-час — граница не рвёт сутки пополам

### `tests/delivery-message.test.ts`

> Просьба продавца (цифровая ниша, сентябрь 2026): в сообщении после оплаты предупреждать, что повторная отправка платная. Правило её магазина, поэтому текст берётся из настроек, а не зашит в код для всех пяти деплоев.

- ставит приписку продавца последним абзацем
- без приписки отправляет текст по умолчанию
- срок жизни ссылок берётся из кода, а не из текста продавца
- вариант с кнопкой на страницу файлов тоже несёт приписку

### `tests/delivery-zones.test.ts`

> Блок 12, находка 12.5 — не было ни одного файла тестов на зоны доставки: ни порядок по sort_order, ни исключение is_active=false, ни весь Telegram-путь зоны (activeDeliveryZones/fulfillmentOptionsEnabled в fulfillment.server.ts) не были покрыты. CRUD-функции самой админки (delivery-zones.functions.ts) обёрнуты в createServerFn с requireAdmin — ни один тест в проекте не поднимает такую сессию, тем же приёмом здесь тестируется не CRUD-обёртка, а бизнес-логика, которую она вызывает.  Против настоящей базы, тем же приёмом, что и tests/fulfillment.test.ts — свой тестовый арендатор, tenant_bot JWT, RLS-изоляция через trg_force_bot_id. Без переменных окружения пропускается, а не падает.  Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \ npx vitest run tests/delivery-zones.test.ts

- activeDeliveryZones возвращает зоны по sort_order, скрытые (is_active=false) не попадают
- activeDeliveryZones не видит зоны другого арендатора (RLS-изоляция)
- activeDeliveryZones — пустой список, если у арендатора нет ни одной зоны (фолбэк на свободный адрес)
- оба способа включены по умолчанию, пока ничего не настроено
- самовывоз выключен явной настройкой — доставка остаётся включённой

### `tests/direct-flow.test.ts`

> Список стран взят из настоящих payment_methods клиента.

- принимает номер в том виде, в каком его пишут покупатели
- снимает ведущие нули — товар «018» покупатель напишет как «18»
- не принимает за номер обычный текст
- берёт номер из названия — это главный источник
- понимает номер через пробел и через вертикальную черту
- не принимает класс за номер товара
- не выдумывает номер, когда его в названии нет
- берёт номер, только если он целое первое слово
- не принимает класс за номер товара
- пустые ключевые слова номера не дают
- понимает порядковый номер из показанного списка
- понимает название, в том числе с флагом и не до конца
- понимает код страны
- не угадывает наугад
- понимает порядковый номер из показанного списка (ru, kk, en, uz)
- понимает код языка в любом регистре
- понимает родное название языка целиком или его начало
- не угадывает наугад
- понимает номер из показанного списка: языки, затем «все»
- не принимает «1 класс» и номер товара за выбор языка
- понимает название языка и постбэк кнопки
- понимает «оба» / «все языки»
- повтор «1» или названия языка сразу после выбора — не номер товара
- после окна снова можно писать короткий номер
- настоящий код материала из публикации не считается эхом языка
- без метки выбора языка короткий номер остаётся номером товара
- понимает слово с кнопки на всех 4 языках
- понимает слово внутри произвольной реплики
- не угадывает наугад
- находит адрес в реплике
- не принимает за почту то, что ею не является
- номер товара опознаётся как номер
- односложный ответ воронке — не поисковый запрос
- всё остальное — вопрос, а не молчаливый поиск по каталогу
- отказ закрывает разговор, а не начинает его заново
- отказ не путается с согласием
- длинная фраза с «спасибо» внутри остаётся вопросом
- понимает все обычные способы выйти
- не принимает за отмену обычную реплику
- понимает команды, написанные словом
- понимает подписи кнопок оформления на всех языках магазина
- понимает запрос смены языка на любом из поддерживаемых языков
- не принимает за команду живую фразу, в которой команда лишь внутри
- узнаёт жалобу на неполученный материал
- не считает жалобой обычный вопрос
- берёт картинку или файл
- не принимает за чек голосовое, видео, пересланный пост и эхо шаблона
- находит чек, даже если он пришёл вместе с голосовым
- на платёжном шаге принимает живые Instagram и WhatsApp media-объекты
- не зависит от нового имени типа, если URL есть
- понимает просьбу убрать позицию
- не принимает за удаление обычную реплику
- находит позицию по номеру материала
- понимает и место в списке — покупатель видит нумерацию
- не угадывает, когда такого в заказе нет
- принимает кнопки и короткие да/нет
- не путает вежливый отказ от разговора с отказом списывать бонусы

### `tests/direct-purchase.test.ts`

> Денежный путь Direct-покупки — против настоящей базы, и иначе никак.  `createOrderFromCart` и `claimAwaitingProof` держатся на поведении, которое мокками не проверить: точную семантику CAS-обновления (`UPDATE … WHERE updated_at = X`, где важно, что Postgres сериализует два одновременных UPDATE над одной строкой, а не что мок вернул нужное значение) и встроенный join `cart_items → products` через PostgREST. Замокав клиента, мы проверили бы мокки — см. тот же выбор в tests/zernio-logs-retention.test.ts.  Тест создаёт свои строки (товар, реквизиты, покупатель, корзина) под уникальным тегом и убирает их за собой. Чужого не трогает.  createOrderFromCart зовётся под ключом арендатора (SUPABASE_TENANT_KEY), а не под service_role: триггер assign_order_no (MIGRATION-03) берёт bot_id из claim'а JWT через current_bot_id(), и без него заказу неоткуда взять order_no — под голым service_role INSERT просто падает на NOT NULL. Ровно то же самое в проде: деплой всегда подключается ключом арендатора.  Без переменных окружения пропускается, а не падает.  Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \ npx vitest run tests/direct-purchase.test.ts

- забирает шаг и переводит его в processing_proof
- второй раз забрать не даёт — шаг уже не awaiting_proof
- не забирает шаг, на котором чек не ждут
- из двух одновременных попыток забирает шаг ровно одна
- считает сумму в валюте страны и снимает файлы товара
- на пустой корзине заказ не создаёт
- физический заказ — записывает fulfillment_type/at/address/note
- физический заказ без fulfillment (устаревший вызов) — поля остаются null
- физический заказ с зоной доставки — total включает комиссию, зона — снимок
- товар с двумя вариантами — createOrderFromCart создаёт две строки с верными вариантами
- товар с вариантами без выбранного варианта в корзину не попадает
- успешное оформление списывает остаток атомарно
- недостаточный остаток — заказ не создаётся, остаток не трогается
- раскупленная вторая позиция — откатывает остаток уже списанной первой

### `tests/direct-receipt-download.test.ts`

- authenticates WhatsApp media and adds the receiving account
- leaves an Instagram CDN URL unauthenticated
- does not duplicate an accountId already present in the Zernio URL

### `tests/direct-reply.test.ts`

- does not mark an answer as sent when Zernio rejects it
- stores the deduplication marker only after successful delivery

### `tests/fulfillment-dates.test.ts`

> Дата-математика чекаута физического заказа (Ниши, Блок 8) — общая для Telegram и Direct-каналов с переезда в fulfillment.server.ts (Блок 8.3). Чистые функции, без похода в базу — раньше не были покрыты тестом вовсе.

- считает длину обычных месяцев
- учитывает високосный год для февраля
- разбирает ДД.ММ.ГГГГ
- отклоняет несуществующую дату
- отклоняет нераспознанный формат
- прибавляет дни в пределах месяца
- переносит через границу месяца и года
- переносит через 29 февраля високосного года
- 0 дней возвращает ту же дату
- переводит YYYY-MM-DD в ДД.ММ.ГГГГ

### `tests/fulfillment-kind.test.ts`

> productHasFiles / cartAllowsProduct (Ниши, Блок 5) — против настоящей базы: оба читают products/cart_items через PostgREST join, тот же выбор, что и в tests/direct-purchase.test.ts.  Без переменных окружения пропускается, а не падает.  Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \ npx vitest run tests/fulfillment-kind.test.ts

- physical-товар без единого файла всё равно продаётся
- digital-товар без файлов по-прежнему не продаётся
- пустая корзина разрешает любой первый товар
- нельзя добавить физический товар, когда в корзине уже цифровой
- можно добавить второй физический товар к уже лежащему физическому

### `tests/fulfillment-reminder.test.ts`

> sendFulfillmentReminders() — CAS-идемпотентность против настоящей базы, тем же приёмом, что tests/fulfillment.test.ts. Без переменных окружения пропускается, а не падает.  Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \ npx vitest run tests/fulfillment-reminder.test.ts

- дата получения дальше суток — рано напоминать
- дата получения в пределах ближайших суток — пора напомнить
- дата получения ровно через 24 часа — на границе, ещё считается
- дата получения уже в прошлом — заказ проглядели, напоминание бесполезно
- дата получения прямо сейчас — уже не будущее, не напоминаем
- уже отправляли — не повторяем, даже если снова в окне
- заказ в ближайшие 24 часа — напоминание отправлено и проставлено ровно один раз
- дата получения дальше суток — заказ не трогается
- заказ ещё не принят продавцом (awaiting_confirmation), но дата уже завтра — напоминание всё равно шлём
- заказ уже выдан (delivered) — напоминание не шлём

### `tests/fulfillment.test.ts`

> Статусная машина физического заказа (Ниши, Блок 6) — против настоящей базы: CAS-переходы держатся на семантике `UPDATE … WHERE status = X`, которую мокками не проверить (тот же выбор, что и в tests/direct-purchase.test.ts).  Без переменных окружения пропускается, а не падает.  Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \ npx vitest run tests/fulfillment.test.ts

- acceptOrder переводит awaiting_confirmation в accepted
- acceptOrder повторно на уже принятом — alreadyAccepted, статус не меняется
- acceptOrder на delivered — тоже alreadyAccepted, не пытается принять заново
- acceptOrder на rejected бросает — отклонённый заказ обратно в работу не берут
- advanceFulfillment проходит accepted → in_production → ready → delivered
- advanceFulfillment из delivered дальше не идёт
- двойное нажатие: из двух одновременных advanceFulfillment ровно один продвигает статус
- recordPayment суммирует внесённое (задаток + остаток)
- processPendingDeliveries не трогает accepted/in_production/ready
- digital-заказ — всегда полная сумма, режим оплаты не смотрится вовсе
- payment_mode не настроен — full по умолчанию, вся сумма
- full — вся сумма
- on_receipt — 0 сейчас
- deposit — доля от суммы по deposit_percent
- deposit с пустым deposit_percent — откатывается на 30%, не на 0₸ (Блок 1, находка 1.7)
- deposit с мусорным deposit_percent (NaN) — откатывается на 30%, не на NaN₸
- deposit с deposit_percent вне диапазона (150) — тоже клэмп на 30%
- recordPayment не даёт paid_amount превысить total (CHECK из MIGRATION-55)

### `tests/gift-certificates.test.ts`

- приводит к верхнему регистру и убирает пробелы по краям
- скидка равна номиналу, но не больше суммы заказа
- нулевая сумма или нулевой номинал — скидки нет
- генерирует код с префиксом GIFT- и 6 символами суффикса
- генерирует разные коды при повторных вызовах

### `tests/instagram-inbox-message.test.ts`

- does not attach a message tag to a regular Direct reply

### `tests/invoices-server.test.ts`

> invoices.server.ts не имела ни одного теста — новая фича (счета на оплату подписки владельцу бота через его же бота, MIGRATION-58). requireOperator мокается тем же приёмом, что и hasModule в других тестах этой сессии: сама сессия/куки оператора здесь не при чём, важна бизнес-логика поверх неё. addPayment (subscriptions.server.ts) мокается шпионом — confirmInvoice не должна изобретать свою бухгалтерию, а обязана позвать уже существующий, отдельно протестированный путь начисления платежа.

- пустые реквизиты по умолчанию, сохраняются и читаются обратно
- отказывает, если реквизиты не заданы
- заводит счёт, отправляет текст владельцу через callInternal, пишет журнал
- снимок реквизитов не меняется у уже отправленного счёта при смене реквизитов
- подтверждает счёт и вызывает addPayment с суммой/валютой счёта
- нельзя подтвердить уже оплаченный счёт повторно
- если addPayment падает — статус откатывается, счёт остаётся подтверждаемым
- двойное подтверждение подряд не задваивает addPayment
- отклоняет счёт с причиной, не трогая addPayment
- отменить можно только счёт без присланного чека
- null, пока чек не прислан; signed URL, когда путь есть

### `tests/loyalty.test.ts`

- считает процент от суммы заказа, округляя вниз
- нулевая сумма или нулевой процент — баллов нет
- списывает баллы 1:1, но не больше суммы заказа
- нулевая сумма или нулевой баланс — скидки нет
- пример клиента: товар 500, на балансе 100 — к оплате 400
- без согласия сумму не трогает
- не списывает больше суммы заказа

### `tests/manual-order.test.ts`

- складывает позиции и комиссию доставки
- без позиций даёт только доставку
- 0 ₸ — ждём оплату, иначе сразу в работу
- один телефон схлопывается в один id
- отрицательный, чтобы не попасть в Telegram-рассылку
- без телефона разные entropy дают разных покупателей
- user_key и telegram_id строятся от одного ключа
- кладёт полночь UTC в календарный день магазина

### `tests/mini-app-auth.test.ts`

- accepts fresh signed initData from the header
- rejects missing and expired credentials
- ignores credentials leaked through the query string
- requires both shop and telegram_mini_app modules

### `tests/mini-app-catalog.test.ts`

- removes products that only belong to hidden categories
- searches names, descriptions, variants and keywords across the full index
- treats the query as one phrase, like the bot, not AND of substrings
- keeps uncategorized products only in the unfiltered catalog
- includes products from Mini App category subtrees
- shows lead time on physical products and hides it for digital
- uses a bakery placeholder on confectionery deploys
- shows compact RU/KZ chips, hides description, and keeps flags on named badges
- [Учителя-CRIT] hides language badges when the multi_language module is off
- filters materials by language and keeps chips for the unfiltered set
- counts materials, not generic products, on the digital vertical
- lists material files on the product page and keeps a library tab
- orders by popularity, recency and price

### `tests/mini-app-library.test.ts`

> listMiniAppLibrary не имела ни одного теста (Ниши/учителя, аудит). Единственное реальное поведение здесь — дедупликация купленных материалов по товару поверх заказов, отсортированных по дате, и исключение физических заказов. Раньше сканировались только последние 80 заказов: покупатель больше чем с 80 заказами терял из "Моих материалов" товары, купленные только в более старых заказах, — они просто не попадали в выборку.

- дедуплицирует по товару, оставляя самый свежий заказ
- исключает физические заказы — библиотека только для цифровых материалов
- не теряет товар, купленный только в заказе старше последних 80
- подставляет актуальное имя и обложку товара, языки материала
- пустая история заказов — пустая библиотека, без похода за товарами

### `tests/mini-app-rate-limit.test.ts`

> Учителя, находка о коллизии лимитов: startPaymentPolling бьёт /api/public/mini-app/orders?poll=1 раз в 4с фоном, пока ждёт оплату, — без отдельного бюджета это делило одну корзину с открытием вкладки «Заказы» самим покупателем, и фоновый опрос мог выесть весь лимит "orders" раньше, чем покупатель успевал сам обновить список.

- limits checkout bursts independently per Telegram user
- uses a separate, larger cart allowance
- limits proof uploads more tightly than cart traffic
- orders_poll имеет свой бюджет, не деля лимит со вкладкой «Заказы»
- orders_poll тоже ограничен — не безлимитный фон

### `tests/mini-app-regressions.test.ts`

> [Учителя-HIGH] Кнопка "Отправить файлы ещё раз" в админке (redeliverOrder → deliverOrder({force:true})) раньше всегда попадала в ветку "спросить язык заново" для позиций без delivery_lang_choice (delivery_lang_timing = "during", самый частый сценарий) — даже если язык для этой позиции уже был один раз выбран и записан в delivered_language при первой выдаче. Покупатель получал повторный вопрос "на каком языке" вместо простого повторного файла. Ветка на parseDeliveredLanguages должна идти РАНЬШЕ ветки с переспросом (availableLangs.length > 1), иначе она мертва.

- ships syntactically valid browser runtime JavaScript
- loads the runtime from the registered route
- continues KZ payment on the existing order instead of recreating it
- exposes pending payment resume and cancellation
- uses delivery zone price and never the nonexistent fee property
- releases order placement for terminal Mini App paths
- escapes cart product names and supports PDP variant controls
- resets Telegram Menu Button when the module is disabled
- does not accept initData credentials through URL query parameters
- exposes receipt upload, orders history and payment return polling
- lets a reviewer add a free-text comment after the star rating (Учителя, отзывы без комментариев)
- searches the catalog without dropping the Telegram WebView hash
- opens Kaspi and other payment URLs from manual instructions
- clears fulfillment checkout state when Mini App country changes
- skips delivery-language checkout for a physical cart
- uses physical completion copy and keeps the Mini App open after any order
- shows material languages and all-languages price like the bot
- filters catalog by material language and uses a two-column grid
- pins catalog add-to-cart buttons to a shared card footer
- does not resend files for physical orders
- redelivers a per-item language choice instead of asking again
- guards the delivery-language callback against a stale button, like fulfilltype:/zone:
- hides Direct purchase buttons for out-of-stock products, on the card and in search results
- does not close an order as delivered while a language choice is still pending
- offers rating for delivered physical orders, unlike file resend
- shares a working t.me deep link instead of the raw Mini App page URL
- ships a purchased-materials library, sort chips and bottom tabs

### `tests/mini-app-related.test.ts`

> loadRelatedMiniAppProducts выходила пустой строкой для любого товара без категории (Учителя, находка про похожие материалы без fallback) — секция "похожие" просто не рендерилась, хотя в каталоге могло быть что показать. Категория у товара необязательна, так что это не редкий случай.

- товар без категории всё равно получает блок похожих — fallback на весь каталог
- товар с категорией использует прежний заголовок и фильтр по категории
- товар из скрытой категории не попадает в похожие
- нет ни одного другого товара в каталоге — секция не рендерится вовсе

### `tests/mini-app-text.test.ts`

- turns Kaspi Pay and https URLs into clickable anchors
- escapes unrelated HTML and keeps trailing punctuation outside the URL

### `tests/mini-app-validation.test.ts`

- normalizes valid phones and rejects invalid input
- validates real ISO dates against the minimum date
- caps free text and enforces required fields
- only accepts supported fulfillment and payment choices

### `tests/misc-retention.test.ts`

> Ретеншн admin_login_attempts, operator_login_attempts, bot_events, broadcast_recipients (Блок 3.2, кейс 2) — против настоящей базы, тем же приёмом, что tests/zernio-logs-retention.test.ts: смысл прохода в том, какие строки PostgREST реально отдаёт под фильтр, а не в том, что вернул мок.  Без переменных окружения пропускается, а не падает.

- pruneAdminLoginAttempts удаляет старое, не трогает свежее
- pruneOperatorAuditTables удаляет старые bot_events и operator_login_attempts
- pruneBroadcastRecipients удаляет получателей кампаний старше окна

### `tests/order-files-page.test.ts`

- round-trips a valid token
- rejects a tampered order id
- rejects an expired token
- rejects a token signed with another secret
- uses TELEGRAM_BOT_TOKEN, not the nonexistent BOT_TOKEN
- lists download links and does not auto-open files
- keeps Instagram button titles within Meta's 20-character limit
- sends a URL button instead of attaching a document

### `tests/order-platform.test.ts`

- keeps Instagram and WhatsApp orders in their own channels
- treats legacy and unknown orders as Telegram
- ждёт почту только у цифрового Instagram-заказа без адреса
- не блокирует Telegram, WhatsApp, физический заказ и уже указанную почту

### `tests/orders-pure.test.ts`

- оборачивает внешнюю ссылку
- оборачивает путь+имя, когда ссылки нет
- ссылка приоритетнее пути, если заданы оба
- пустой массив, если нет ни ссылки, ни пути
- дописывает расширение из storagePath к человеческому имени
- не дублирует расширение, если оно уже есть в имени
- заменяет запрещённые в именах файлов символы на пробел
- схлопывает повторные пробелы и обрезает края
- обрезает слишком длинное имя до 80 символов основы
- подставляет запасное имя, если после очистки ничего не осталось
- без расширения в пути хранилища возвращает имя как есть

### `tests/payment-proof.test.ts`

- accepts jpeg/png/pdf with matching magic bytes
- rejects empty files, spoofed mime types and oversized payloads

### `tests/pricing.test.ts`

> Числа взяты из настоящего каталога и из объяснения продавца: в основном поле стоит завышенная цена (1000 ₸), в цене для Казахстана — настоящая (800 ₸), а для остальных стран сумма считается по курсу от основной.

- читает плоскую карту, которую пишет админка
- понимает и старый вид с валютой
- пустое поле — это «считать по курсу», а не ноль
- для Казахстана берёт ручную цену, а не основную
- для России считает по курсу и показывает рубли
- при неизвестной стране считает по домашней стране продавца
- товар без цен по странам считается по курсу от основной
- страна без реквизитов не роняет расчёт
- курс недоступен (convertAmount вернул null) — откатывается на базовую цену
- игнорирует ручную цену страны и конвертацию — всегда база
- подставляет цену варианта вместо базовой products.price
- курс всё ещё применяется к цене варианта для другой страны
- ручная цена страны (country_prices) для варианта не ищется — сознательный обход
- без модуля multi_currency — тоже цена варианта, без конвертации
- для домашней страны продавца — без конвертации
- для другой страны — конвертирует по курсу, а не просто меняет ярлык
- страна ещё не выбрана — считает по домашней стране продавца
- страна без реквизитов — остаётся домашняя валюта, число не выдумывается
- курс недоступен (convertAmount вернул null) — откатывается на домашнюю валюту
- без модуля multi_currency — всегда домашняя валюта, независимо от страны

### `tests/product-materials.test.ts`

> Тот самый товар, на котором потерялся оплаченный заказ №484 из Instagram: файл у него есть, но лежит только в product_material_files, а снимок заказа копировал одни старые поля file_path/file_url — и выдача не нашла ничего.

- берёт файлы из product_material_files
- сохраняет порядок, заданный продавцом
- не путает языки — включая новые en/uz, не только ru/kk
- падает на старые поля, когда таблицы файлов нет (только ru/kk — у en/uz такой пары не было)
- у товара без файлов не выдумывает материал
- считает так же, как снимок, по всем 4 языкам
- возвращает только те языки, для которых реально есть файл
- берёт из material_files_by_lang, когда он заполнен
- откатывается на старые ru/kk снимки, если карты по языкам нет
- откатывается на совсем старые одиночные *_snapshot-колонки
- en/uz не имеют legacy-отката — пусто, если карты по языкам нет
- берёт первый непустой язык по порядку ru→kk→en→uz
- пусто, если ни в одном языке ничего нет
- «both» — исторический синоним ru+kk
- список через запятую разбирается как множество языков
- пусто/мусор — пустое множество
- добавление языка накапливает список, а не перезаписывает
- несколько языков, ничего ещё не выбрано — ждёт выбора
- несколько языков, один уже отмечен как выданный — выбор больше не нужен
- один доступный язык — выбирать нечего, вопрос не нужен
- модуль multi_language выключен — считаем только ru, даже если у товара есть kk
- товар без файлов вовсе — не блокирует выдачу вопросом о языке
- признаёт конкретный язык и «all», отвергает мусор
- конкретный язык — цена не меняется
- «все языки» — множитель равен числу ИМЕННО ЭТОГО товара, не общему числу языков системы

### `tests/promo-codes.test.ts`

- приводит к верхнему регистру и убирает пробелы по краям
- процентная скидка считается от суммы и округляется
- фиксированная скидка — как есть, но не больше суммы заказа
- нулевая или отрицательная сумма — скидки нет

### `tests/receipt-audit.test.ts`

- путь как есть, плюс префикс bot_id если его ещё нет
- уже с префиксом — не дублируем
- когда номера разные — пишем оба, как в админке #868 vs проверка №871
- одинаковые или без админского — только один номер
- пустой и robokassa — не чек
- путь в storage — да
- по расширению
- хеш или OCR ok — автовыдача
- выдан без следа OCR — руками
- очереди
- ok / отказ / ручная / нет файла
- выдан автопроверкой + OCR принял бы — сошлось
- выдан руками + OCR принял бы — если бы включили, ушёл бы сам
- ждёт продавца + OCR принял бы — расхождение
- мы выдали, OCR отклонил бы неуспешный платёж — опасно
- просили переслать + OCR отклонил бы — сошлось
- автовыдача + OCR на ручную — предупреждение
- ручная выдача + OCR на ручную — сошлось по сути
- очередь + OCR на ручную — сошлось
- считает severity

### `tests/receipt-ocr-auto.test.ts`

- без ключа и с true — автопроверка включена
- явное false выключает автопроверку
- тумблер включён — читаем чек даже без proof_auto (KZ до кнопки реквизитов)
- тумблер выключен и нет proof_auto — обычный заказ, OCR нет
- без ключа и с true — автопроверка включена
- явное false выключает автопроверку

### `tests/receipt-verify.test.ts`

- недоплата больше 30% не проходит
- недоплата в пределах 30% проходит
- переплата на 30% проходит
- переплата больше 30% не проходит
- точное совпадение всегда проходит
- допуски настраиваемые через opts
- константы соответствуют документированным значениям
- если в чеке ожидаемая валюта — берём её, даже когда рядом другая
- только чужая валюта — возвращаем её
- нет маркеров — null
- чек с явным упоминанием другой валюты — конфликт
- чек с ожидаемой валютой — не конфликт
- чек без упоминания какой-либо валюты — не конфликт (доверяем сумме, как раньше)
- валюта вне списка известных — не блокируем
- без ожидаемой валюты — не проверяем вообще
- одинаковые байты — одинаковый хеш
- разные байты — разный хеш
- отсекает чек, где банк пишет, что платёж не прошёл
- успешный чек с оговоркой «в случае ошибки» не считается отказом
- payment_failed просим переслать, а не кладём в ручную выдачу
- узнаёт PDF по mime и по сигнатуре %PDF
- текст с маркером платежа и суммой — похоже на чек
- случайный текст без маркеров — не похоже
- скрин сообщения бота «заказ создан / сумма к оплате» — не чек
- карточка товара с «в корзине» — не чек, даже если сумма та же
- настоящий чек не режется, даже если сверху попал текст бота
- извлекает суммы с разделителем тысяч
- ВТБ: сумма операции 228 ₽ и выплата 1101.24 KZT, не телефон и не дата
- Сбер: сумма в местной валюте 1077.30 KZT
- Сбер: 661.50 и 1072.58 KZT тоже читаются
- Kaspi фискальный: 1 900 ₸ не выкидывается как год
- голое 1900 тоже сумма, не год
- экран «Платёж выполнен» 227 ₽
- 1000 RUB не идёт в пул KZT
- на смешанном чеке в KZT остаётся выплата, не рубли
- чек уже принят по другому заказу — receipt_reused, автовыдачи нет
- чек новый (нет совпадения по хешу) — автовыдача, proofHash в результате
- чек с ошибкой оплаты — payment_failed, даже если сумма совпадает
- успешный чек с фразой «в случае ошибки» — автовыдача
- чек с тенге и рублями — находит 1101.24 KZT под заказ 1100 ₸
- на экране только 227 ₽ — переводим заказ 1100 ₸ и принимаем
- Сбер «местная валюта» 1077.30 KZT на заказ 228 ₽ — принимаем (спред банка ~10%)
- Сбер 661.50 KZT на заказ 152 ₽ — ~17% ниже mid-market, в допуске ±30%
- Сбер ~50% ниже mid-market — всё ещё к продавцу
- фискальный Kaspi PDF-текст 1 900 ₸ на заказ 1900 — принимаем
- скрин карточки товара вместо чека — не принимаем
- скрин сообщения бота с той же суммой — not_receipt, не автовыдача
- чек в другой валюте — переводим сумму заказа и сверяем
- чек в другой валюте, сумма после курса не сошлась — amount_mismatch
- PDF идёт в files:annotate и проходит ту же сверку суммы
- картинка по-прежнему идёт в images:annotate

### `tests/reviews-server.test.ts`

> reviews.server.ts (upsertReview/updateReviewComment/reviewableProductsForOrder) не имела ни одного теста. updateReviewComment — единственный путь дописать комментарий к уже сохранённой оценке (Учителя, находка про отзывы без комментариев): Mini App никогда его не вызывала, хотя функция существовала.

- возвращает уникальные товары доставленного заказа этого покупателя
- чужой заказ или недоставленный — пустой список
- оценка звёздами пишется без комментария, комментарий дописывается отдельным вызовом
- updateReviewComment для несуществующей оценки — false, без побочных эффектов

### `tests/reviews.test.ts`

- принимает только целые числа от 1 до 5
- отвергает нецелые и выходящие за диапазон значения
- рисует нужное число закрашенных и пустых звёзд
- округляет и не выходит за границы 1..5
- форматирует среднюю оценку с одним знаком после запятой
- без отзывов — ничего не показываем

### `tests/robokassa.test.ts`

- считает обычный MD5 в hex, как ждёт Robokassa
- подписывает login:outSum:invId:pass1 и подставляет параметры в URL
- IsTest=1 только когда явно попросили
- принимает подпись, посчитанную тем же паролем
- подпись регистронезависима, как отдаёт сама Robokassa
- отклоняет подпись, посчитанную другим паролем (например, тестовым)
- отклоняет, если сумма в подписи не совпадает с переданной
- учитывает Shp_-параметры отсортированными по ключу, как того требует протокол
- не падает и не принимает подпись другой длины (защита timingSafeEqual от RangeError)
- устойчива к таймингу: сравнение идёт через crypto.timingSafeEqual, а не ===
- NaN от нечислового OutSum не считается прошедшей проверку суммы

### `tests/smart-search.test.ts`

> Раньше промпт всегда говорил "товар в интернет-магазине" одинаково для обеих ниш платформы — учителя ищут по предмету/классу/теме урока, кондитерская по поводу/начинке/оформлению, и общая формулировка не давала модели контекста домена, в котором вообще происходит поиск.

- достаёт id из чистого JSON
- достаёт JSON, даже если модель добавила текст вокруг
- отбрасывает id, которых нет среди реальных кандидатов
- пустой список ids — пустой результат
- невалидный JSON — пустой результат, не бросает
- ids не массив — пустой результат
- считает USD по прайсу Haiku 4.5: $1/MTok in, $5/MTok out
- сбрасывает дневной счётчик и расход на новую дату
- накапливает токены и USD за день
- достаёт usage из ответа Anthropic
- форматирует мелкие суммы с 4 знаками
- digital (умолчание, VERTICAL не задан) — промпт про учебные материалы
- confectionery — промпт про торты и десерты
- consultant — промпт про прайс, не учебные материалы

### `tests/telegram-init-data.test.ts`

- принимает корректный initData
- отклоняет подпись с другим токеном
- отклоняет просроченный auth_date

### `tests/telegram-webapp-init-data.test.ts`

- читает tgWebAppData из hash Mini App
- читает tgWebAppData из query string
- собирает значение, если внутренний query не закодирован целиком
- пустой hash — пустая строка
- берёт tgWebAppData из JSON, который пишет telegram-web-app.js
- игнорирует битый JSON
- разбирает сохранённый hash+search
- предпочитает SDK, затем capture, затем hash
- захватывает launch params до SDK и не просит закрыть окно

### `tests/tenant-isolation.test.ts`

> Изоляция арендаторов — самая дорогая из возможных поломок: клиент видит заказы и покупателей другого клиента. Держится она не на коде приложения, а на RLS в базе (MIGRATION-02) и на claim bot_id внутри SUPABASE_TENANT_KEY. Проверить это можно только против настоящей базы: подделать RLS мокками значит проверить мокки.  Тест ничего не пишет — только читает.  Запуск: SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \ SUPABASE_JWT_SECRET=… npx vitest run tests/tenant-isolation.test.ts  Без этих переменных тест пропускается, а не падает: в обычном прогоне секретов нет и быть не должно.

- ключ арендатора видит только свои заказы
- ключ арендатора видит только своих покупателей
- ключ арендатора видит только свои товары
- два ключа видят разные наборы строк
- в bots арендатор видит одну строку — свою
- служебные таблицы панели арендатору недоступны
- подделанная подпись не принимается

### `tests/vip-flow.test.ts`

- зажимает снизу: короткая подписка (тест-режим) даёт хотя бы 10 минут на переход
- зажимает сверху: многомесячная подписка не даёт ссылку жить дольше 24 часов
- между 10 минутами и 24 часами — берёт срок подписки как есть
- ровно на границах не пересекает их
- в обычном режиме считает дни тарифа
- без duration_days подставляет 30 дней по умолчанию
- в тест-режиме считает МИНУТЫ, а не дни — это и есть источник прод-инцидента
- без duration_minutes в тест-режиме подставляет единое умолчание
- duration_minutes: 0 не даёт нулевой срок — тоже уходит в умолчание
- в обычном режиме сдвигает на дни
- в тест-режиме сдвигает на минуты — окна предупреждений тоже уезжают
- использует переданные значения как есть, если они валидны и упорядочены
- подставляет умолчания 3/1 на пустые строки
- подставляет умолчания на нечисловой мусор
- отбрасывает значения меньше 1
- подтягивает второе окно ближе первого, если оно сохранено равным или больше
- не опускает второе окно ниже 1 даже при warnDays=1
- возвращает пустой список на null
- оставляет по одной строке на пользователя — с самой поздней датой истечения
- активная подписка: продление считается от текущего срока истечения
- истёкшая/неактивная подписка: продление считается от «сейчас», не от старой даты
- active, но expires_at уже в прошлом — тоже считается неактивной (past due)
- уменьшение, уводящее дату в прошлое — помечается shortenedPast
- уменьшение, оставляющее дату в будущем — не помечается shortenedPast

### `tests/web-storefront-handoff.test.ts`

- совпадает с форматом deep link
- quantity по умолчанию 1 в типе

### `tests/whatsapp-activation.test.ts`

- waits silently after the prompt until /start
- starts the existing flow when /start arrives
- restarts an activated or in-progress WhatsApp flow on /start
- restarts Instagram on /start so a CMD «Купить» button wakes the shop
- does not intercept Instagram or an activated WhatsApp flow
- can disable only the first auto-reply while keeping /start active
- uses the requested activation text
- uses the configured activation text and falls back for a blank value
- treats a hidden /start payload as start even when the chat shows «купить»
- treats a CMD payload that is itself a trigger word as start
- does not wake the shop on a typed «купить» without a postback
- ignores native Zernio ACT:: buttons and ordinary chat

### `tests/whatsapp-broadcast-audience.test.ts`

> Кому уходит WhatsApp-рассылка (Блок B.3, кейс 2, раунд 2).  Раньше resolveWhatsAppAudience не читала список исключённых номеров вовсе — его читал только живой автоответчик (zernio-bot.server.ts). Продавец добавляет туда номер, когда клиент попросил не писать; рассылка всё равно его задевала, и для WhatsApp Business API это прямой риск жалоб.

- без списка исключений отдаёт всех подряд
- исключённый номер не попадает в рассылку
- исключение работает и для аудитории по стране

### `tests/whatsapp-catalog.test.ts`

> Каталог WhatsApp упирается в лимиты Meta, а не в наши предпочтения: на всё сообщение десять строк, заголовок строки 24 символа, описание 72, текст кнопки 20. Перебор Meta не подсвечивает — она молча режет или отвечает ошибкой, и для покупателя это выглядит как «половина каталога пропала».  Первая версия каталога как раз в это и уперлась: плоский список на десять товаров у клиента с 387 позициями и названиями по 162 символа. Тесты держат обе границы — и раскладку страницы, и обрезку строк.

- корень разбирается в parentId = null
- категория и смещение читаются как есть
- отсутствующее или битое смещение — это ноль, а не NaN
- чужие постбэки не перехватываются
- «Назад» из категории ведёт к её родителю, а не к ней самой
- не отдаёт больше строк, чем принимает Meta
- лимит общий на сообщение, а не на секцию
- пустые секции выбрасываются — Meta на них отвечает ошибкой
- длинные тексты режутся по границам Meta
- страница оставляет место под «Назад» и «Ещё»
- короткому названию описание — просто цена
- длинное название продолжается в описании — там товары и расходятся
- цена дописывается, когда остаётся место
- не влезает вместе — хвост названия важнее цены

### `tests/whatsapp-contact-exclusions.test.ts`

- normalizes pasted numbers and removes duplicates
- matches the webhook phone across Kazakhstan/Russia formats
- falls back to a numeric sender id and ignores invalid entries

### `tests/zernio-account-disconnected.test.ts`

> handleZernioAccountDisconnected — единственный способ узнать, что бот в Direct молча перестал отвечать (истёкший или отозванный токен Zernio). Проверяется мокками: сама функция чистая с точки зрения побочных эффектов (app_settings + Telegram), а не завязана на семантику PostgREST, как CAS в direct-purchase.server.ts, — мокать здесь безопасно и достаточно.

- уведомляет продавца по всем адресам из admin_chat_id
- без настроенного admin_chat_id ничего не отправляет
- не повторяет уведомление о том же аккаунте раньше шести часов
- другой аккаунт уведомляется даже пока первый ещё в кулдауне

### `tests/zernio-automation-body.test.ts`

> Сборка тела запроса к автоматизации — место, где легко навредить в обе стороны: не вычистишь null — уйдёт «на все посты» как значение поля; вычистишь слишком усердно — оператор не сможет очистить публичный ответ, а пустой список ключевых слов («срабатывать на любой комментарий») превратится в его отсутствие.

- опускает null у идентификаторов поста — это автоматизация на все посты
- сохраняет пустую строку — ею оператор очищает поле
- сохраняет пустой список ключевых слов — это «любой комментарий»
- приводит ключевые слова к нижнему регистру и убирает пустые
- требует текст сообщения — без него отправлять нечего
- с кнопками предел 640 символов
- без кнопок предел 1000 символов
- проверяет длину и у вариантов текста — они ротируются наравне с основным

### `tests/zernio-base-url.test.ts`

- uses the official API URL when unset
- repairs the common host-only Vercel configuration
- preserves explicit API and proxy base URLs
- calls the JSON API even when Vercel contains only the Zernio host
- reports a useful configuration error for an HTML response

### `tests/zernio-idempotency.test.ts`

> Ключ идемпотентности легко испортить незаметно: ошибёшься в одну сторону — клиент получит два одинаковых сообщения при повторной доставке вебхука, ошибёшься в другую — законный повтор будет молча проглочен как дубль. Ни то, ни другое не видно ни в логах, ни в типах, поэтому проверяется здесь.

- повтор того же события даёт тот же ключ
- разные события с тем же текстом дают разные ключи
- разные сообщения внутри одного события дают разные ключи
- вне обработки события ключа нет — ручную отправку подавлять нельзя
- без идентификатора события контекст не выставляется
- контекст не протекает наружу после обработки

### `tests/zernio-inbox-order.test.ts`

> Zernio отдаёт не больше ста сообщений за раз. С сортировкой по возрастанию это сто ПЕРВЫХ: в живом диалоге BOVI самое свежее исходящее в таком ответе было от 15 сентября, хотя менеджер писал сегодня. Поэтому запрашиваем последние, а порядок наружу восстанавливаем сами.

- ответ от новых к старым разворачивается в хронологический
- ответ уже в хронологическом порядке не портится
- последним оказывается самое свежее — его и проверяет защита

### `tests/zernio-inbox-shape.test.ts`

> Zernio присылает текст сообщения под именем text, а время под sentAt — это видно в журнале вебхуков (поля id, text, isRead, sender, sentAt, sentVia, platform, direction). Весь наш код читал message и createdAt, то есть для него такое сообщение было пустым. Отсюда и бот, не замечающий менеджера: сообщений в переписке он «не видел» вовсе.

- текст и время читаются под обоими именами
- менеджер находится и в сообщении из вебхучной формы

### `tests/zernio-logs-retention.test.ts`

> Ретенция zernio_logs — проверка против настоящей базы, и иначе никак: весь смысл прохода в том, какие строки PostgREST отдаёт под фильтр `status = processed AND created_at < cutoff`, а замокав клиент, мы проверили бы мокки.  Тест создаёт свои строки и их же убирает за собой. Чужого не трогает: все записи помечены собственным event_id с префиксом ниже, и проверки смотрят только на них.  На момент написания порог в 30 дней не удалял ничего — самой старой записи в базе было 16 дней. Именно поэтому ветку удаления надо проверять явно: в обычном прогоне она ещё долго не выполнится ни разу.  Без переменных окружения тест пропускается, а не падает.

- удаляет отработанное старше порога и не трогает свежее и недавние ошибки
- сообщает done, когда удалять нечего

### `tests/zernio-message.test.ts`

> Форма события взята не из головы, а из настоящей записи `zernio_logs` — события `message.received` от 12.08.2026. Ровно на этой форме прежний разбор и промахивался: он читал профиль отправителя из `payload.data`, поля, которого Zernio не присылает вовсе.

- разбирает настоящее событие целиком
- забирает профиль подписчика — то самое, что молча терялось
- не выдумывает профиль, когда Instagram его не прислал
- text=null у сообщения с одним вложением читается как пустая строка
- нажатие кнопки отдаёт payload, обычное сообщение — null
- подставляет имя, когда Instagram не дал ни имени, ни юзернейма
- берёт accountId как канонический, а не id
- использует Mongo-style _id, если accountId и id отсутствуют
- строка списка WhatsApp читается из корня события
- подпись строки приходит текстом и остаётся в text, не подменяя payload
- кнопка Instagram читается по своему ключу postbackPayload
- кнопка чужой автоматизации Zernio отдаётся как есть
- кнопка WhatsApp (button_reply) читается так же, как строка списка
- запасное чтение из message.metadata работает, если форма вернётся
- обычное сообщение нажатием не считается
- нативная корзина Meta разбирается из корня события
- неизвестная платформа не роняет разбор и считается instagram

### `tests/zernio-post-ids.test.ts`

- берёт analytics.postId — в доке Zernio это id поста
- не подставляет Instagram media id вместо id Zernio
- не берёт latePostId — это id издателя, не поста
- принимает _id из GET /posts
- отличает media id Instagram от ObjectId Zernio
- помечает правило, где в postId лежит Instagram id
- помечает правило без postId
- не ругается на нормальную пару
- отделяет Reels от фото

### `tests/zernio-retry.test.ts`

> Добор застрявших pending-событий — против настоящей базы: сама выборка (`status = pending AND created_at < cutoff AND bot_id = …`) и переходы статусов держатся на поведении PostgREST/RLS, а не на форме объекта.  `handleZernioMessage` в этом тесте замокан — иначе добор попытался бы дойти до настоящего Zernio/Telegram API. Здесь проверяется не тело обработчика (для него есть свои тесты), а то, какие строки добор выбирает и как расставляет статусы.  Вызов идёт под ключом арендатора (SUPABASE_TENANT_KEY), а не под service_role: retryStuckZernioEvents фильтрует по bot_id явно, и тест обязан проверять именно этот путь — иначе легко получить проход, который трогает застрявшие события чужих, настоящих клиентов в общей базе.  Без переменных окружения пропускается, а не падает.  Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \ npx vitest run tests/zernio-retry.test.ts

- забирает застрявшее message.received, обходит свежее, отмечает чужой тип и держит сбой
- выключенный модуль instagram — добор не трогает ничего

### `tests/zernio-webhook.test.ts`

- accepts an HMAC-SHA256 signature for the untouched raw body
- rejects missing credentials, altered bodies and altered signatures
- missing when there is no store webhook at all
- stale when the record points at another host
- stale when the record is inactive or no longer listens for DMs
- ok when this deployment is already registered for incoming DMs
- detects another FrogFlow deploy holding the shared Zernio webhook
- does not treat this deploy or a non-store URL as foreign
- recognizes a client store workspace by public webhook path
- sales fit is ok only for the operator URL listening to DMs
- принимает id из вебхука, не только mongo _id
- если Instagram один — не отбрасывает чужой формат accountId
- двум аккаунтам без точного id не угадывает

