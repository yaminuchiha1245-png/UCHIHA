"""
وحدة ربط API JS4Card Store - توافق كامل مع دليل المبرمج
✅ العنوان الصحيح: https://api.js4card.com/client/api
✅ الإصلاحات:
   - إضافة آلية إعادة المحاولة (Retry) عند انقطاع الاتصال
   - استخدام TCPConnector مخصص لتجنب إغلاق الاتصال المبكر
   - زيادة مهلة الانتظار (Timeout) لاستيعاب الاستجابات الكبيرة
   - معالجة صريحة لـ ClientPayloadError و ServerDisconnectedError
"""

import aiohttp
import asyncio
import logging
import uuid
import json
import os
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from typing import Optional, Dict, List, Any

logger = logging.getLogger(__name__)

# عدد محاولات إعادة الاتصال عند الفشل
MAX_RETRIES = 3
# الانتظار بين المحاولات (بالثواني)
RETRY_DELAY = 3


class JS4CardAPI:
    """فئة للتعامل مع API JS4Card Store"""

    def __init__(self, api_token: str, connection_limit: int = 10):
        self.api_token = api_token
        # عدد الاتصالات المتزامنة. يقبل هذا الخيار لأن المزامنة الكبيرة
        # تضبطه من bot.py لتجنب الضغط الزائد وحدود الموقع.
        try:
            self.connection_limit = max(1, int(connection_limit))
        except (TypeError, ValueError):
            self.connection_limit = 10

        # ✅ العنوان الصحيح والفعال
        self.base_url = "https://api.js4card.com/client/api"
        self.headers = {
            "api-token": api_token,
            "Content-Type": "application/json"
        }
        self.last_payment_methods_error: str = ''
        self.last_payment_methods_path: str = ''
        self.last_payment_methods_complete: bool = False
        self.last_payment_methods_pages: int = 0

        # جلسة مشتركة لمهام المزامنة الكبيرة بدلاً من فتح اتصال جديد لكل قسم.
        self._session: Optional[aiohttp.ClientSession] = None
        self._request_gate = asyncio.Lock()
        self._next_request_at: float = 0.0
        self._cooldown_until: float = 0.0
        try:
            self._adaptive_delay = max(0.25, float(os.getenv('API_REQUEST_DELAY_SECONDS', '0.75')))
        except (TypeError, ValueError):
            self._adaptive_delay = 0.75
        self._min_request_delay = 0.25
        self._max_request_delay = 8.0
        self.rate_limit_hits = 0

    async def __aenter__(self):
        """فتح جلسة واحدة يعاد استخدامها طوال المزامنة."""
        await self._ensure_session()
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        await self.close()
        return False

    def _make_connector(self) -> aiohttp.TCPConnector:
        """إنشاء TCPConnector مخصص لتجنب مشاكل انقطاع الاتصال"""
        return aiohttp.TCPConnector(
            keepalive_timeout=60,
            limit=self.connection_limit,
            force_close=False,
            enable_cleanup_closed=True
        )

    def _make_timeout(self, total: int = 300) -> aiohttp.ClientTimeout:
        """إنشاء كائن Timeout مناسب (تمت الزيادة لـ 300 ثانية للبيانات الضخمة)"""
        return aiohttp.ClientTimeout(total=total, connect=60, sock_read=240)


    async def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                connector=self._make_connector(),
                headers=self.headers,
            )
        return self._session

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()
        self._session = None

    async def _wait_for_request_slot(self) -> None:
        """توزيع الطلبات زمنياً ومنع اندفاعها دفعة واحدة نحو الموقع."""
        loop = asyncio.get_running_loop()
        async with self._request_gate:
            now = loop.time()
            target = max(self._next_request_at, self._cooldown_until)
            if target > now:
                await asyncio.sleep(target - now)
            now = loop.time()
            self._next_request_at = now + self._adaptive_delay

    def _register_success(self) -> None:
        # بعد مجموعة نجاحات نعود تدريجياً للسرعة الطبيعية.
        self._adaptive_delay = max(self._min_request_delay, self._adaptive_delay * 0.94)

    async def _register_rate_limit(self, response: aiohttp.ClientResponse, attempt: int, label: str) -> float:
        retry_after = response.headers.get('Retry-After', '').strip()
        try:
            wait_time = float(retry_after)
        except (TypeError, ValueError):
            wait_time = max(5.0, min(60.0, (attempt + 1) * 7.5))
        wait_time = max(2.0, min(wait_time, 120.0))
        self.rate_limit_hits += 1
        self._adaptive_delay = min(
            self._max_request_delay,
            max(self._adaptive_delay * 1.8, 1.25),
        )
        self._cooldown_until = max(
            self._cooldown_until,
            asyncio.get_running_loop().time() + wait_time,
        )
        logger.warning(
            'Rate limit 429 for %s; cooling down %.1fs, request delay %.2fs',
            label, wait_time, self._adaptive_delay,
        )
        return wait_time

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        total_timeout: int = 300,
        retries: int = 5,
        label: str = 'request',
    ) -> Optional[Any]:
        session = await self._ensure_session()
        for attempt in range(max(1, retries)):
            try:
                await self._wait_for_request_slot()
                async with session.request(
                    method,
                    url,
                    params=params,
                    timeout=self._make_timeout(total_timeout),
                ) as resp:
                    if 200 <= resp.status < 300:
                        data = await resp.json(content_type=None)
                        self._register_success()
                        return data
                    if resp.status == 429:
                        await self._register_rate_limit(resp, attempt, label)
                        continue
                    if resp.status in (500, 502, 503, 504) and attempt < retries - 1:
                        wait_time = min(30.0, 2.5 * (2 ** attempt))
                        logger.warning('Server error %s for %s; retrying in %.1fs', resp.status, label, wait_time)
                        await asyncio.sleep(wait_time)
                        continue
                    body = (await resp.text())[:300].replace('\n', ' ')
                    logger.error('%s failed: HTTP %s - %s', label, resp.status, body)
                    return None
            except (aiohttp.ClientPayloadError, aiohttp.ServerDisconnectedError, aiohttp.ClientConnectionError, asyncio.TimeoutError) as exc:
                if attempt >= retries - 1:
                    logger.error('%s failed after %s attempts: %s', label, retries, exc)
                    return None
                wait_time = min(30.0, RETRY_DELAY * (2 ** attempt))
                logger.warning('%s connection error (%s/%s): %s; retrying in %.1fs', label, attempt + 1, retries, exc, wait_time)
                await asyncio.sleep(wait_time)
            except Exception as exc:
                logger.error('%s unexpected error: %s', label, exc, exc_info=True)
                return None
        return None

    async def validate_token(self) -> bool:
        """التحقق من صحة التوكن عبر جلب بيانات الملف الشخصي"""
        data = await self._request_json(
            'GET', f'{self.base_url}/profile',
            total_timeout=60, retries=3, label='profile validation',
        )
        if not isinstance(data, dict):
            return False
        logger.info('Token validation successful for: %s', data.get('email'))
        return bool(
            'balance' in data or 'email' in data or
            data.get('status') in ('OK', 'success')
        )

    async def get_profile(self) -> Optional[Dict[str, Any]]:
        """الحصول على بيانات الملف الشخصي والرصيد"""
        for attempt in range(MAX_RETRIES):
            try:
                connector = self._make_connector()
                async with aiohttp.ClientSession(connector=connector) as session:
                    async with session.get(
                        f"{self.base_url}/profile",
                        headers=self.headers,
                        timeout=self._make_timeout(60)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            if data.get('status') == 'OK':
                                logger.info(f"Profile fetched: Balance={data.get('balance')}, Email={data.get('email')}")
                            else:
                                logger.warning(f"API returned non-OK status: {data}")
                            return data
                        else:
                            logger.error(f"Profile fetch failed: {resp.status}")
                            return None
            except (aiohttp.ClientPayloadError, aiohttp.ServerDisconnectedError) as e:
                logger.warning(f"Connection error in get_profile (attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY)
            except Exception as e:
                logger.error(f"Profile fetch error: {e}")
                return None
        return None

    async def get_products(self, product_ids: Optional[List[int]] = None) -> Optional[List[Dict]]:
        """جلب قائمة المنتجات بطلب واحد مع تهدئة تلقائية عند ضغط الموقع."""
        url = f'{self.base_url}/products'
        params = None
        if product_ids:
            params = {'products_id': ','.join(map(str, product_ids))}
        data = await self._request_json(
            'GET', url, params=params,
            total_timeout=400, retries=5, label='products',
        )
        if isinstance(data, list):
            logger.info('Products fetched: %s products', len(data))
            return data
        logger.warning('Unexpected response format from get_products: %s', type(data).__name__)
        return None

    async def get_content(self, category_id: int = 0) -> Optional[Dict[str, Any]]:
        """جلب محتوى قسم مع تأخير متكيّف يحترم حد طلبات الموقع."""
        data = await self._request_json(
            'GET', f'{self.base_url}/content/{category_id}',
            total_timeout=300, retries=7, label=f'category {category_id}',
        )
        return data if isinstance(data, dict) else None

    async def create_order(
        self,
        product_id: int,
        qty: int = 1,
        player_id: Optional[str] = None,
        **extra_params
    ) -> Dict[str, Any]:
        """إنشاء طلب بمعرّف ثابت ومن دون تكراره عند انقطاع الاتصال."""
        requested_uuid = str(extra_params.pop('order_uuid', '') or uuid.uuid4())
        params: Dict[str, Any] = {"qty": qty, "order_uuid": requested_uuid}
        if player_id:
            params["playerId"] = player_id
        params.update(extra_params)
        url = f"{self.base_url}/newOrder/{product_id}/params"
        session = await self._ensure_session()
        last_error = ''

        for attempt in range(MAX_RETRIES):
            try:
                await self._wait_for_request_slot()
                logger.info(
                    "Creating order: product_id=%s qty=%s uuid=%s",
                    product_id, qty, requested_uuid,
                )
                async with session.post(
                    url,
                    params=params,
                    timeout=self._make_timeout(60),
                ) as resp:
                    body_text = await resp.text()
                    try:
                        payload = json.loads(body_text) if body_text else {}
                    except json.JSONDecodeError:
                        payload = {'message': body_text[:1000]}
                    if not isinstance(payload, dict):
                        payload = {'data': payload}
                    payload.setdefault('_request_uuid', requested_uuid)
                    payload['_http_status'] = resp.status

                    if 200 <= resp.status < 300:
                        payload['_ok'] = True
                        payload['_definitive_failure'] = False
                        self._register_success()
                        return payload

                    if resp.status == 429:
                        last_error = clean_text = str(payload.get('message') or body_text or 'rate limit')[:500]
                        await self._register_rate_limit(resp, attempt, f'create order {product_id}')
                        continue

                    if resp.status in (408, 425, 500, 502, 503, 504) and attempt < MAX_RETRIES - 1:
                        last_error = str(payload.get('message') or body_text or f'HTTP {resp.status}')[:500]
                        await asyncio.sleep(min(20.0, RETRY_DELAY * (2 ** attempt)))
                        continue

                    payload['_ok'] = False
                    payload['_definitive_failure'] = 400 <= resp.status < 500 and resp.status not in (408, 425, 429)
                    payload.setdefault('status', 'ERROR')
                    payload.setdefault('message', body_text[:1000] or f'HTTP {resp.status}')
                    logger.error(
                        "Order creation rejected: HTTP %s - %s",
                        resp.status, payload.get('message'),
                    )
                    return payload
            except (
                aiohttp.ClientPayloadError,
                aiohttp.ServerDisconnectedError,
                aiohttp.ClientConnectionError,
                asyncio.TimeoutError,
            ) as exc:
                last_error = str(exc)
                logger.warning(
                    "Connection error in create_order (%s/%s): %s",
                    attempt + 1, MAX_RETRIES, exc,
                )
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(min(20.0, RETRY_DELAY * (2 ** attempt)))
                    continue
            except Exception as exc:
                last_error = str(exc)
                logger.error("Order creation unexpected error: %s", exc, exc_info=True)
                break

        return {
            'status': 'UNKNOWN',
            'message': last_error or 'تعذر التأكد من إرسال الطلب بسبب الاتصال',
            '_ok': False,
            '_definitive_failure': False,
            '_request_uuid': requested_uuid,
        }

    async def check_orders(self, order_ids: List[str], by_uuid: bool = False) -> Optional[Dict[str, Any]]:
        """
        التحقق من حالة الطلبات

        Args:
            order_ids: قائمة معرفات الطلبات
            by_uuid: هل نتحقق بواسطة UUID أم بمعرف الطلب

        Returns:
            بيانات الطلبات أو None في حالة الفشل
        """
        for attempt in range(MAX_RETRIES):
            try:
                orders_json = json.dumps(order_ids)
                params = {"orders": orders_json}
                if by_uuid:
                    params["uuid"] = "1"

                logger.info(f"Checking orders: {order_ids}, by_uuid={by_uuid}")

                connector = self._make_connector()
                async with aiohttp.ClientSession(connector=connector) as session:
                    async with session.get(
                        f"{self.base_url}/check",
                        headers=self.headers,
                        params=params,
                        timeout=self._make_timeout(60)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            logger.info(f"Orders checked: {data}")
                            return data
                        else:
                            logger.error(f"Order check failed: {resp.status}")
                            return None
            except (aiohttp.ClientPayloadError, aiohttp.ServerDisconnectedError) as e:
                logger.warning(f"Connection error in check_orders (attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY)
            except Exception as e:
                logger.error(f"Order check error: {e}")
                return None
        return None

    async def get_order_status(self, order_id: str) -> Optional[str]:
        """الحصول على حالة طلب واحد"""
        try:
            result = await self.check_orders([order_id])
            if result and result.get('status') == 'OK':
                data = result.get('data', [])
                if data:
                    status = data[0].get('status')
                    logger.info(f"Order {order_id} status: {status}")
                    return status
            logger.warning(f"Could not get status for order {order_id}")
            return None
        except Exception as e:
            logger.error(f"Get order status error: {e}")
            return None

    @staticmethod
    def _extract_payment_items(payload: Any) -> List[Dict[str, Any]]:
        """استخراج قائمة طرق الدفع من أكثر أشكال JSON شيوعاً."""
        if isinstance(payload, list):
            result: List[Dict[str, Any]] = []
            for item in payload:
                if isinstance(item, dict):
                    result.append(dict(item))
                elif isinstance(item, str) and item.strip():
                    result.append({'name': item.strip()})
            return result

        if not isinstance(payload, dict):
            return []

        container_keys = (
            'payment_methods', 'paymentMethods', 'payment-methods',
            'deposit_methods', 'depositMethods', 'deposit-methods',
            'methods', 'payments', 'wallets', 'gateways',
            'items', 'data', 'result', 'results', 'list',
        )
        for key in container_keys:
            if key in payload:
                items = JS4CardAPI._extract_payment_items(payload.get(key))
                if items:
                    return items

        name_keys = {
            'name', 'title', 'label', 'display_name', 'displayName',
            'method_name', 'payment_method',
        }
        if any(key in payload for key in name_keys):
            return [dict(payload)]

        # بعض الواجهات تعيد قاموساً يكون رمز الطريقة هو المفتاح.
        mapped: List[Dict[str, Any]] = []
        for key, value in payload.items():
            if isinstance(value, dict):
                item = dict(value)
                item.setdefault('code', key)
                mapped.append(item)
            elif isinstance(value, str) and value.strip():
                mapped.append({'code': key, 'name': value.strip()})
        return mapped

    @staticmethod
    def _payment_next_url(payload: Any, current_url: str) -> Optional[str]:
        """استخراج رابط الصفحة التالية مع قبول أشهر صيغ الترقيم."""
        if not isinstance(payload, dict):
            return None

        candidates: List[Any] = [
            payload.get('next_page_url'), payload.get('nextPageUrl'),
            payload.get('next_url'), payload.get('nextUrl'), payload.get('next'),
        ]
        links = payload.get('links')
        if isinstance(links, dict):
            candidates.extend([links.get('next'), links.get('next_page_url')])

        for value in candidates:
            if isinstance(value, str) and value.strip():
                value = value.strip()
                if value.startswith('?'):
                    base = urlparse(current_url)
                    return urlunparse(base._replace(query=value[1:]))
                if value.startswith('/'):
                    base = urlparse(current_url)
                    return f'{base.scheme}://{base.netloc}{value}'
                if not value.startswith(('http://', 'https://')):
                    return urljoin(current_url, value)
                return value

        meta = payload.get('meta') if isinstance(payload.get('meta'), dict) else payload
        current = meta.get('current_page', meta.get('currentPage', meta.get('page')))
        last = meta.get('last_page', meta.get('lastPage', meta.get('total_pages', meta.get('totalPages'))))
        try:
            current_int = int(current)
            last_int = int(last)
        except (TypeError, ValueError):
            return None
        if current_int >= last_int:
            return None

        parsed = urlparse(current_url)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query['page'] = str(current_int + 1)
        return urlunparse(parsed._replace(query=urlencode(query)))

    async def get_payment_methods(self, preferred_path: Optional[str] = None) -> Optional[Any]:
        """
        جلب جميع طرق الدفع التي تعرضها واجهة الموقع، مع دعم الصفحات المتعددة.

        ملاحظة مهمة: بعض حسابات JS4Card لا توفر مساراً عاماً لطرق الدفع.
        عند توفر مسار خاص للحساب يمكن وضعه في ملف .env عبر:
        API_PAYMENT_METHODS_PATH=/path
        أو عدة مسارات مفصولة بفواصل عبر API_PAYMENT_METHODS_PATHS.
        """
        self.last_payment_methods_error = ''
        self.last_payment_methods_path = ''
        self.last_payment_methods_complete = False
        self.last_payment_methods_pages = 0

        configured_paths: List[str] = []
        single_path = os.getenv('API_PAYMENT_METHODS_PATH', '').strip()
        multiple_paths = os.getenv('API_PAYMENT_METHODS_PATHS', '').strip()
        for raw_path in [preferred_path or '', single_path, *multiple_paths.split(',')]:
            path = raw_path.strip().strip('/')
            if path and path not in configured_paths:
                configured_paths.append(path)

        candidate_paths: List[str] = list(configured_paths)
        # لا يتم استخدام أقسام المنتجات كمصدر لطرق الدفع إطلاقاً.
        for path in (
            'payment-methods', 'payment_methods', 'paymentMethods',
            'deposit-methods', 'deposit_methods', 'depositMethods',
            'payments', 'methods', 'wallets', 'gateways',
        ):
            if path not in candidate_paths:
                candidate_paths.append(path)

        try:
            max_pages = int(os.getenv('API_PAYMENT_MAX_PAGES', '100').strip())
        except (TypeError, ValueError):
            max_pages = 100
        max_pages = max(1, min(max_pages, 500))

        configured_timeout = aiohttp.ClientTimeout(total=45, connect=15, sock_read=30)
        discovery_timeout = aiohttp.ClientTimeout(total=12, connect=5, sock_read=8)
        connector = self._make_connector()
        headers = dict(self.headers)
        headers['Accept'] = 'application/json'

        try:
            async with aiohttp.ClientSession(connector=connector) as session:
                for path in candidate_paths:
                    is_configured_path = path in configured_paths
                    request_timeout = configured_timeout if is_configured_path else discovery_timeout
                    request_attempts = MAX_RETRIES if is_configured_path else 1
                    first_url = path if path.startswith(('http://', 'https://')) else f'{self.base_url}/{path}'
                    url = first_url
                    all_items: List[Dict[str, Any]] = []
                    seen_keys = set()
                    complete = True
                    pages = 0

                    while url and pages < max_pages:
                        # منع اتباع روابط خارج نطاق API حفاظاً على التوكن.
                        parsed = urlparse(url)
                        base_host = urlparse(self.base_url).netloc
                        if parsed.netloc and parsed.netloc != base_host:
                            logger.warning('Ignored external payment pagination URL: %s', url)
                            complete = False
                            break

                        page_payload: Any = None
                        page_succeeded = False
                        for attempt in range(request_attempts):
                            try:
                                async with session.get(url, headers=headers, timeout=request_timeout) as resp:
                                    response_text = await resp.text()

                                    if resp.status == 200:
                                        try:
                                            page_payload = json.loads(response_text)
                                        except json.JSONDecodeError:
                                            logger.warning('Unreadable payment response from %s', url)
                                            complete = False
                                            break
                                        page_succeeded = True
                                        break

                                    if resp.status in (401, 403):
                                        self.last_payment_methods_error = (
                                            'توكن الموقع غير صالح أو لا يملك صلاحية قراءة طرق الدفع.'
                                        )
                                        logger.error('Payment methods authorization failed: %s', resp.status)
                                        return None

                                    if resp.status in (404, 405):
                                        # المسار غير متاح؛ نجرب المسار التالي دون اعتبار ذلك خطأً قاتلاً.
                                        break

                                    if resp.status == 429:
                                        retry_after = resp.headers.get('Retry-After', '')
                                        try:
                                            wait_time = max(2.0, min(float(retry_after), 60.0))
                                        except (TypeError, ValueError):
                                            wait_time = min(4.0 * (attempt + 1), 30.0)
                                        if attempt < request_attempts - 1:
                                            logger.warning(
                                                'Rate limit for payment methods; retrying in %.1fs (%s/%s)',
                                                wait_time, attempt + 1, request_attempts,
                                            )
                                            await asyncio.sleep(wait_time)
                                            continue
                                        self.last_payment_methods_error = (
                                            'الموقع رفض الطلبات مؤقتاً بسبب كثرة الاتصالات.'
                                        )
                                        complete = False
                                        break

                                    short_body = response_text[:250].replace('\n', ' ')
                                    logger.warning(
                                        'Payment methods request failed: HTTP %s - %s',
                                        resp.status, short_body,
                                    )
                                    complete = False
                                    break

                            except (aiohttp.ClientPayloadError, aiohttp.ServerDisconnectedError, asyncio.TimeoutError) as exc:
                                logger.warning(
                                    'Payment methods connection error (%s/%s): %s',
                                    attempt + 1, request_attempts, exc,
                                )
                                if attempt < request_attempts - 1:
                                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))
                                    continue
                                self.last_payment_methods_error = (
                                    'انقطع الاتصال أثناء جلب طرق الدفع من الموقع.'
                                )
                                complete = False
                            except aiohttp.ClientError as exc:
                                logger.warning('Payment methods HTTP error: %s', exc)
                                self.last_payment_methods_error = (
                                    'حدث خطأ في الاتصال بالموقع أثناء جلب طرق الدفع.'
                                )
                                complete = False
                                break
                            except Exception as exc:
                                logger.error('Payment methods fetch error: %s', exc, exc_info=True)
                                self.last_payment_methods_error = (
                                    f'حدث خطأ غير متوقع أثناء جلب طرق الدفع: {exc}'
                                )
                                complete = False
                                break

                        if not page_succeeded:
                            break

                        pages += 1
                        page_items = self._extract_payment_items(page_payload)
                        if not page_items:
                            # نجاح HTTP لا يعني أن هذا مسار طرق الدفع؛ جرب مساراً آخر.
                            all_items = []
                            break

                        for item in page_items:
                            raw_key = (
                                item.get('id') or item.get('method_id') or item.get('code')
                                or item.get('slug') or item.get('name') or item.get('title')
                                or json.dumps(item, ensure_ascii=False, sort_keys=True, default=str)
                            )
                            key = str(raw_key).strip().casefold()
                            if key and key not in seen_keys:
                                seen_keys.add(key)
                                all_items.append(item)

                        next_url = self._payment_next_url(page_payload, url)
                        if not next_url:
                            url = None
                        elif next_url == url:
                            complete = False
                            url = None
                        else:
                            url = next_url

                    if all_items:
                        self.last_payment_methods_path = path
                        self.last_payment_methods_complete = complete and not url
                        self.last_payment_methods_pages = pages
                        logger.info(
                            'Payment methods fetched: %s methods from %s in %s page(s)',
                            len(all_items), path, pages,
                        )
                        return {
                            'payment_methods': all_items,
                            '_sync_meta': {
                                'path': path,
                                'complete': self.last_payment_methods_complete,
                                'pages': pages,
                            },
                        }

            if not self.last_payment_methods_error:
                self.last_payment_methods_error = (
                    'لم يعرض حساب JS4Card مساراً قابلاً للقراءة لطرق الدفع. '
                    'إذا زودك الموقع بمسار خاص، ضعه في API_PAYMENT_METHODS_PATH داخل .env.'
                )
            return None
        finally:
            if not connector.closed:
                await connector.close()

    async def get_product_quantities(self, product_id: int) -> Optional[Dict[str, Any]]:
        """
        الحصول على معلومات الكميات المتاحة للمنتج

        Returns:
            قاموس يحتوي على min و max للكميات المتاحة
        """
        try:
            products = await self.get_products([product_id])
            if products and len(products) > 0:
                product = products[0]
                qty_values = product.get('qty_values', {})
                logger.info(f"Product {product_id} quantities: {qty_values}")
                return qty_values
            logger.warning(f"Product {product_id} not found")
            return None
        except Exception as e:
            logger.error(f"Get product quantities error: {e}")
            return None
