/* Simple one-screen subscriber overrides. No FX calculations, no stored secrets. */
function v183BuildSubscriberExtras(data, tenantCurrency, translate) {
  const tr = typeof translate === "function" ? translate : (ar => ar);
  const val = key => String(data.get(key) ?? "").trim();
  const phone = val("phone");
  if (!/^[+0-9 ()-]{6,30}$/.test(phone) || phone.replace(/\D/g, "").length < 6)
    throw Error(tr("أدخل رقم هاتف صحيحًا للمشترك", "Enter a valid subscriber phone number"));
  const speed = val("speedDownMbps"), upload = val("speedUpMbps");
  const quota = val("dailyQuotaAmount"), unit = val("dailyQuotaUnit") || "GB";
  const currency = val("priceCurrency") || "USD";
  const prices = {};
  const pricePattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
  for (const code of ["USD", "SYP", "TRY"]) {
    const value = val("price" + code);
    if (value) {
      if (!pricePattern.test(value))
        throw Error(tr("أدخل سعرًا صحيحًا بحد أقصى منزلتين عشريتين", "Enter an exact price with at most two decimals"));
      prices[code] = value;
    }
  }
  const customized = Boolean(speed || upload || quota || Object.keys(prices).length);
  if (!customized) return { phone };
  const integer = (raw, label, max) => {
    const number = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(number) || number > max)
      throw Error(tr("قيمة غير صالحة: " + label, "Invalid value: " + label));
    return number;
  };
  const speedDownMbps = integer(speed, tr("سرعة التنزيل", "Download speed"), 100000);
  const speedUpMbps = upload ? integer(upload, tr("سرعة الرفع", "Upload speed"), 100000) : undefined;
  const dailyQuota = quota ? {
    amount: integer(quota, tr("حد الاستهلاك اليومي", "Daily usage quota"), 1000000),
    unit
  } : null;
  if (!["MB", "GB"].includes(unit))
    throw Error(tr("اختر MB أو GB للاستهلاك اليومي", "Choose MB or GB for daily usage"));
  if (!["USD", "SYP", "TRY"].includes(currency) || !Object.hasOwn(prices, currency))
    throw Error(tr("حدد سعرًا للعملة المختارة", "Enter the price in the selected currency"));
  const billingCurrency = ["USD", "SYP", "TRY"].includes(tenantCurrency) ? tenantCurrency : "USD";
  if (!Object.hasOwn(prices, billingCurrency))
    throw Error(tr("أدخل سعرًا مستقلًا أيضًا بعملة شبكتك " + billingCurrency,
      "Also enter an independent price in your network currency " + billingCurrency));
  return { phone, accessProfile: {
    speedDownMbps,
    ...(speedUpMbps === undefined ? {} : { speedUpMbps }),
    dailyQuota, priceCurrency: currency, prices
  } };
}

/* Inject only into the already-authenticated V1-83 subscriber form; frozen UI stays intact. */
function v183InstallSubscriberFields(form, networkCurrency, translate) {
  if (!form || form.querySelector("#v183-basic-subscriber-fields")) return;
  const nameLabel = form.elements.name?.closest("label");
  if (!nameLabel) return;
  const t = translate || (ar => ar);
  const currency = ["USD", "SYP", "TRY"].includes(networkCurrency) ? networkCurrency : "USD";
  const options = ["USD", "SYP", "TRY"].map(c => '<option value="'+c+'"'+
    (c === currency ? ' selected' : '')+'>'+c+'</option>').join('');
  const html = '<fieldset id="v183-basic-subscriber-fields" class="v183-basic-subscriber-fields">'+
    '<legend>'+t('بيانات الاشتراك','Subscription settings')+'</legend>'+
    '<label class="v183-field-full"><span>'+t('رقم الهاتف','Phone')+'</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="30" required placeholder="09xxxxxxxx"></label>'+
    '<label><span>'+t('سرعة التنزيل Mbps','Download Mbps')+'</span><input name="speedDownMbps" type="number" inputmode="numeric" min="1" max="100000" step="1" placeholder="10"></label>'+
    '<label><span>'+t('سرعة الرفع Mbps (اختياري)','Upload Mbps (optional)')+'</span><input name="speedUpMbps" type="number" inputmode="numeric" min="1" max="100000" step="1" placeholder="5"></label>'+
    '<label><span>'+t('حد الاستهلاك اليومي','Daily usage limit')+'</span><input name="dailyQuotaAmount" type="number" inputmode="numeric" min="1" max="1000000" step="1" placeholder="'+t('اختياري','Optional')+'"></label>'+
    '<label><span>'+t('وحدة الاستهلاك','Usage unit')+'</span><select name="dailyQuotaUnit"><option value="GB">GB</option><option value="MB">MB</option></select></label>'+
    '<label class="v183-field-full"><span>'+t('عملة الاشتراك','Subscriber currency')+'</span><select name="priceCurrency">'+options+'</select></label>'+
    '<label><span>'+t('السعر بالدولار USD','USD price')+'</span><input name="priceUSD" type="text" inputmode="decimal" autocomplete="off" placeholder="10.00"></label>'+
    '<label><span>'+t('السعر بالسوري SYP','SYP price')+'</span><input name="priceSYP" type="text" inputmode="decimal" autocomplete="off" placeholder="120000"></label>'+
    '<label class="v183-field-full"><span>'+t('السعر بالتركي TRY','TRY price')+'</span><input name="priceTRY" type="text" inputmode="decimal" autocomplete="off" placeholder="400.00"></label>'+
    '<p class="v183-field-full v183-subscriber-help">'+
      t('أدخل سعر العملة المختارة وعملة الشبكة دون تحويل تلقائي. أو اختر باقة واترك التخصيص فارغاً.','Quote your selected and network currencies independently, without automatic FX. Or choose a plan and leave overrides empty.')+
    '</p></fieldset>';
  nameLabel.insertAdjacentHTML("afterend", html);
  // A custom profile intentionally has no plan. Native form validation must
  // not block it because the legacy select initially required a plan.
  form.elements.plan?.removeAttribute?.("required");
}
