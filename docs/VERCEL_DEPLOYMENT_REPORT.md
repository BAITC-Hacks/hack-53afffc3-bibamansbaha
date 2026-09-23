# Vercel + Neon — журнал развёртывания

23 сентября 2026. Публичное демо: **https://ekt-assistant.vercel.app**.

Рабочая версия приложения: `4668b758177ccd4d3d3d4816cd15e3cd62b851f6`.
Проверенный production deployment: `dpl_8e2z1hfYb2FZUtg4KDkbg7wYo1cP`.
Финальная отправка README/этого отчёта не меняет код приложения; её SHA будет
передан в metadata последнего Vercel deployment. Публикуется архив только tracked-файлов main.

По распоряжению владельца Brev/WSL больше не используются. Уже запущенный DISM
штатно завершился (0), SFC штатно завершился (1, требуется restart). Новых циклов
ремонта, WSL, Brev CLI и SSH после смены стратегии не запускалось.

Оба официальных CLI авторизованы владельцем в браузере: Vercel 59.25.4,
Neon CLI 5.0.1. Созданы один Vercel project `ekt-assistant` (Next.js, Node 24.x)
и один Neon project `late-math-54657922` / `ekt-assistant` / `neondb`, PostgreSQL 17,
AWS us-east-1, 0.25 CU. Организация Neon подтверждена как free. Платные функции
и автопополнение не включались. GitHub integration пока отказала в подключении
репозитория; CLI deployment доступен и будет привязан к проверенному main SHA.

Минимальный перенос: PostgreSQL хранит целиком исходный session aggregate
(cart/items, proposals, confirmation receipts, requested_lines, messages/context).
Бизнес-правила CartService остаются прежними. В рамках запроса рабочая копия
находится в SQLite `:memory:` и уничтожается после запроса; файловой SQLite в
production нет. PostgreSQL SELECT FOR UPDATE удерживает блокировку сессии
до атомарного сохранения состояния; process-local locks не используются.
Деньги остаются целыми minor units, точный расчёт через BigInt сохранён.

Отдельные PostgreSQL ledger: acceptance 6/$0.25, demo 100/$1, без автоматического
сброса. GPT-5.5 Responses low подготовлен и проверяется без платных генераций.
Тариф $5/M input, $30/M output; reasoning входит в output, не считается дважды.
Vision high резервирует до 3000 image tokens плюс запас на инструкции/схему.
Резервы на запрос рассчитываются до вызова, ошибки/timeout сохраняют резерв.

Acceptance calls этого развёртывания: **5**, расчётный расход **$0.014855**. $10 резерва аккаунта
не расходуются; приложение будет ограничено $1 demo + $0.25 acceptance.
Это ограничение приложения, не чтение общего billing balance аккаунта.

## Подтверждённые результаты

- Vercel project `ekt-assistant`, команда `seoshiros-projects`, plan **Hobby**.
- Neon organization plan **Free**, database `neondb`, PostgreSQL 17; pooled TLS URL
  передан только в серверные secrets. `001_neon.sql` применён; локальная БД не импортировалась.
- Production secrets: OPENAI_API_KEY, OPENAI_MODEL=gpt-5.5, DATABASE_URL,
  EKT_API_BASE_URL, EKT_API_USERNAME, EKT_API_PASSWORD, budget/catalog config.
  APP_ORIGIN=https://ekt-assistant.vercel.app. Значения credentials не публикуются.
- Production build выполнялся на Linux Vercel (Node 24.x), `npm ci`, `next build`.
- Главная и `/api/state` дают HTTP 200 в новой сессии без Vercel login.
- Cookies: Secure, HttpOnly, SameSite=Lax; origin/CSRF не отключались.
- Runtime model returned: **gpt-5.5-2026-04-23**, Responses API,
  `reasoning.effort=low`, `store=false`, SDK maxRetries=0, timeout 30 секунд.
  Tool loops/streaming в приложении не используются.

| Реальный вызов | Input | Output | Reasoning в output | Provider, мс | Весь route, мс | USD |
|---|---:|---:|---:|---:|---:|---:|
| DEMO-CABLE, 2 упаковки | 290 | 37 | 0 | 2530 | 3138 | 0.002560 |
| Поиск автоматов | 358 | 31 | 0 | 1504 | 2167 | 0.002720 |
| Второй вариант, 5 метров | 417 | 36 | 0 | 2136 | 2726 | 0.003165 |
| Новый JPEG, DEMO-CABLE / 2 упаковки | 483 | 31 | 0 | 6973 | 7340 | 0.003345 |
| Условия оплаты/доставки | 445 | 28 | 0 | 1253 | 1837 | 0.003065 |

Тариф проверен по [официальной странице GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5):
$5/M input, $30/M output; скидка cache не предполагается. Это оценка по usage,
не выписка billing. Одноразовый acceptance остаётся 6/$0.25, не возобновляется.
Demo — отдельные 100 вызовов/$1. Смена deployment не обнуляет ни один ledger.

| Проверка | Результат / доказательство |
|---|---|
| Локальная регрессия | 98 unit/integration + 24 браузерных E2E PASS |
| Typecheck / lint / production build | PASS, в том числе Vercel Linux build |
| Neon concurrency | Два confirm одновременно → одна revision; три configured-AI state одновременно → HTTP 200 |
| Neon budget | 9 конкурирующих reservations → только 6 acceptance; demo доступен независимо; снижение cap до 0 сохраняется |
| HTTP/HTTPS и новая сессия | Главная/state HTTP 200 без аккаунта Vercel |
| CSV / XLSX / DOCX / text PDF | Новые безопасные файлы распарсились на production |
| JPEG real vision | Новое изображение распознано GPT-5.5; `rawUnit=упаковки`, количество 2 |
| Контекст | «Второй вариант, 5 метров» выбрал второй SKU из реально показанного предыдущего результата |
| Product / аналог / сведения о покупке | Fixture product data, выбран C16-IN вместо отсутствующего C16-OUT; условия содержат ссылки на источники |
| Unknown unit | Предложение до review → UNIT_REVIEW; после явной проверки единиц → разрешено |
| Отказ | «не добавляй» не изменило корзину и не вызвало модель |
| CSV → proposal → confirm | Две позиции, totalMinor=502500, revision=1 |
| Vision → review → proposal → confirm | DEMO-CABLE; ручное подтверждение единиц; корзина сохранена |
| Duplicate confirm | Revision осталась 1; повторного добавления нет |
| Reload / две сессии | Корзина сохранилась; новая сессия пуста |
| 360 / 390 / 1280 / 1440 | Проверены после загрузки состояния, нет горизонтального overflow; screenshots в docs/vercel-evidence |
| `/cart`, `/embed` | Корзина видна, виджет открывает рабочий чат |
| Browser errors | В проверенном бесплатном пути pageErrors=[] |
| Secrets | Staged scan PASS; архив публикации содержит только tracked source; credentials только server env |
| Повторный deployment | Проверка финального переключения acceptance→demo выполняется перед передачей |

## Исправления по найденным deployment-проблемам

1. PDF worker отсутствовал в output trace. Добавлен точный include; build проверяет наличие
   файла, повторная загрузка настоящего PDF на публичном URL прошла.
2. Session-транзакции могли занять все соединения и блокировать budget query. Выделены
   независимые ограниченные pools для сессий и вспомогательных запросов; budget reservation
   коммитится отдельно до обращения к OpenAI. Конкурентный тест на Neon прошёл.
3. PostgreSQL budget первоначально игнорировал снижение env-limit. Теперь параметры
   валидируются и могут только уменьшать сохранённые caps; история остаётся неизменной.

Code-review: Standards — нарушений AGENTS/CONTEXT не найдено, P1 pool и P2 lower caps
исправлены. Spec — один P1 pool исправлен. Возможное дублирование тарифной арифметики
между локальным и PostgreSQL адаптерами отмечено как рекомендация, не функциональный дефект.

## Ограничения и непроведённые проверки

- Публичное демо намеренно работает с **fixture** (6 синтетических товаров), явно помеченным
  в интерфейсе. Реквизиты EKT перенесены, live adapter сохранён; свежий live EKT запрос
  именно из Vercel пока не измерялся. Цены/остатки demo не выдаются за реальные.
- EKT-018: API-контракт units/certificates остаётся неполным; данные не выдумываются.
- EKT-019: корзина prototype, не native ekt.kz; реальные заказы не выполнялись.
- EKT-002: фото/сканы уходят внешнему AI; предупреждение показано, полноценная DLP не заявляется.
- EKT-017: измерены реальные GPT и end-to-end route выше; cold/warm live EKT на Vercel
  не проверялись, поэтому историческое замечание целиком не закрывается.
- EKT-020: первоначальный production-start блокер преодолён новым Vercel deployment;
  это новое доказательство, исторический аудит не изменён.
- Большие файлы ограничены 4 МБ; до 20 PDF-страниц, до 3 vision-страниц за действие.
  Scanned PDF с платным OCR на Vercel не запускался отдельно: сохранён бюджет, настоящий JPEG проверен.
- Общий billing balance OpenAI не читается обычным API-ключом. Гарантируются лимиты
  этого приложения ($1+$0.25), не расходы других приложений пользователя.
- GitHub integration Vercel не получила доступ к организационному репозиторию;
  автоматический deploy каждого push не настроен. Публикация через официальный CLI
  из проверенного main работает. Backup/restore Neon отдельно не тестировались.
- SQLite `:memory:` — временная рабочая копия в одном invocation, PostgreSQL — единственное
  постоянное production-хранилище. Блокировка длится во время внешних вызовов одной сессии;
  запросы этой сессии выполняются последовательно, lock timeout 15 секунд.

Исторические FINAL_AUDIT.md, REPAIR_REPORT.md и DEPLOYMENT_ACCEPTANCE.md не переписаны.
