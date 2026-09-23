# Vercel + Neon — журнал развёртывания

23 сентября 2026, 17:30 UTC+5. Текущая публикация ещё не выполнена.

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

Acceptance calls этого развёртывания: **0**, расход **$0**. $10 резерва аккаунта
не расходуются; приложение будет ограничено $1 demo + $0.25 acceptance.
Это ограничение приложения, не чтение общего billing balance аккаунта.

Далее: migrations → storage/concurrency regression → production build → серверные
secrets → Vercel production → бесплатные сценарии → ограниченный настоящий
GPT-5.5/vision → повторное развёртывание и проверка persistence → README с URL.
