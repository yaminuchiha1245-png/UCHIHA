"""Registration experience upgrades for Uchiha Store."""

from __future__ import annotations

import unicodedata
from typing import Any

USERNAME_MESSAGE = (
    "اسم المستخدم يجب أن يكون بين 3 و35 محرفًا، ويمكن استخدام الحروف "
    "العربية أو الإنكليزية والأرقام والرموز _ - . دون مسافات."
)


def normalize_username(value: str) -> str:
    username = unicodedata.normalize("NFKC", str(value or "")).strip()
    if not 3 <= len(username) <= 35:
        raise ValueError(USERNAME_MESSAGE)
    if any(char.isspace() for char in username):
        raise ValueError(USERNAME_MESSAGE)
    if not all(char.isalnum() or char in "_.-" for char in username):
        raise ValueError(USERNAME_MESSAGE)
    if not any(char.isalnum() for char in username):
        raise ValueError(USERNAME_MESSAGE)
    return username


SIGNUP_CSS = r"""
    .signup-progress{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 18px}
    .signup-progress span{height:5px;border-radius:99px;background:var(--panel-3);transition:.25s}
    .signup-progress span.active{background:linear-gradient(90deg,var(--primary),var(--secondary));box-shadow:0 0 18px rgba(var(--primary-rgb),.22)}
    .signup-step-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
    .signup-step-head b{font-size:14px}.signup-step-head small{color:var(--muted);font-size:9px}
    .signup-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.signup-actions.one{grid-template-columns:1fr}
    .field.invalid .input,.field.invalid .select{border-color:rgba(255,104,129,.7);box-shadow:0 0 0 4px rgba(255,104,129,.08)}
    .field-error{display:none;margin-top:7px;color:#ff9cab;font-size:9px;line-height:1.6}.field.invalid .field-error{display:block}
    .field-hint{display:block;margin-top:7px;color:var(--muted);font-size:8px;line-height:1.6}
    .phone-row{display:grid;grid-template-columns:112px 1fr;gap:8px;direction:ltr}
    .phone-code{display:flex;align-items:center;justify-content:center;min-height:50px;border:1px solid var(--line);border-radius:15px;background:var(--panel-3);font-weight:900;direction:ltr}
    #signupPhone{direction:ltr;text-align:left}
    .password-strength{height:5px;margin-top:8px;border-radius:99px;background:var(--panel-3);overflow:hidden}.password-strength i{display:block;width:0;height:100%;border-radius:inherit;background:var(--danger);transition:.25s}.password-strength i.medium{background:#d8b968}.password-strength i.strong{background:#67d39b}
    .terms-check{display:flex;align-items:flex-start;gap:9px;margin:13px 2px;color:var(--muted);font-size:9px;line-height:1.75}.terms-check input{width:18px;height:18px;flex:0 0 auto;margin-top:1px;accent-color:var(--primary)}.terms-check a{color:#ff9aa3;text-decoration:underline}
    .signup-safe-note{display:flex;align-items:center;gap:7px;margin:12px 2px 0;color:var(--muted);font-size:8px}.signup-safe-note:before{content:"✓";width:18px;height:18px;display:grid;place-items:center;border-radius:50%;background:rgba(103,211,155,.1);color:#8ee7b7}
    @media(max-width:680px){.signup-actions{grid-template-columns:1fr}.phone-row{grid-template-columns:100px 1fr}}
"""

OLD_SIGNUP_FORM = r'''      <form class="auth-form" id="signupForm" data-auth-form="signup">
        <div class="form-grid">
          <div class="field"><label for="firstName">الاسم الأول</label><input class="input" id="firstName" autocomplete="given-name" required></div>
          <div class="field"><label for="lastName">الاسم الأخير</label><input class="input" id="lastName" autocomplete="family-name"></div>
          <div class="field full"><label for="signupUsername">اسم المستخدم</label><input class="input" id="signupUsername" autocomplete="username" required></div>
          <div class="field full"><label for="signupEmail">البريد الإلكتروني</label><input class="input" id="signupEmail" type="email" autocomplete="email" required></div>
          <div class="field"><label for="signupCountry">البلد</label><input class="input" id="signupCountry" autocomplete="country-name" placeholder="مثال: سوريا" required></div>
          <div class="field"><label for="signupPhone">رقم الهاتف</label><input class="input" id="signupPhone" autocomplete="tel" inputmode="tel" placeholder="+963..." required></div>
          <div class="field full"><label for="signupPassword">كلمة المرور (8 أحرف على الأقل)</label><div class="password-wrap"><input class="input" id="signupPassword" type="password" autocomplete="new-password" minlength="8" required><button type="button" data-toggle-password="signupPassword">◉</button></div></div>
        </div>
        <button class="primary-btn wide" type="submit">إنشاء حساب</button>
      </form>'''

NEW_SIGNUP_FORM = r'''      <form class="auth-form" id="signupForm" data-auth-form="signup" novalidate>
        <div class="signup-progress" aria-label="تقدم إنشاء الحساب"><span class="active" data-progress="1"></span><span data-progress="2"></span></div>
        <section data-signup-step="1">
          <div class="signup-step-head"><b>البيانات الشخصية</b><small>الخطوة 1 من 2</small></div>
          <div class="form-grid">
            <div class="field"><label for="firstName">الاسم الأول</label><input class="input" id="firstName" autocomplete="given-name" maxlength="60" placeholder="مثال: يامن"><small class="field-error" data-error-for="firstName"></small></div>
            <div class="field"><label for="lastName">الاسم الأخير</label><input class="input" id="lastName" autocomplete="family-name" maxlength="60" placeholder="مثال: أوتشيها"><small class="field-error" data-error-for="lastName"></small></div>
            <div class="field full"><label for="signupCountry">الدولة</label><select class="select" id="signupCountry" autocomplete="country-name"><option value="">اختر دولتك</option></select><small class="field-error" data-error-for="signupCountry"></small></div>
            <div class="field full"><label for="signupPhone">رقم الهاتف</label><div class="phone-row"><div class="phone-code" id="signupPhoneCode">+---</div><input class="input" id="signupPhone" autocomplete="tel-national" inputmode="numeric" maxlength="15" placeholder="رقم الهاتف دون رمز الدولة"></div><small class="field-error" data-error-for="signupPhone"></small><small class="field-hint">سيُضاف رمز الدولة تلقائيًا، فلا تكتبه مرة ثانية.</small></div>
          </div>
          <div class="signup-actions one"><button class="primary-btn wide" type="button" id="signupNext">متابعة</button></div>
        </section>
        <section data-signup-step="2" hidden>
          <div class="signup-step-head"><b>بيانات الدخول</b><small>الخطوة 2 من 2</small></div>
          <div class="form-grid">
            <div class="field full"><label for="signupUsername">اسم المستخدم</label><input class="input" id="signupUsername" autocomplete="username" maxlength="35" placeholder="مثال: يامن_اوتشيها"><small class="field-error" data-error-for="signupUsername"></small><small class="field-hint">من 3 إلى 35 محرفًا، عربي أو إنكليزي أو أرقام، دون مسافات.</small></div>
            <div class="field full"><label for="signupEmail">البريد الإلكتروني</label><input class="input" id="signupEmail" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com"><small class="field-error" data-error-for="signupEmail"></small></div>
            <div class="field full"><label for="signupPassword">كلمة المرور</label><div class="password-wrap"><input class="input" id="signupPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="8 أحرف على الأقل"><button type="button" data-toggle-password="signupPassword" aria-label="إظهار كلمة المرور">◉</button></div><div class="password-strength"><i id="passwordStrengthBar"></i></div><small class="field-error" data-error-for="signupPassword"></small></div>
            <div class="field full"><label for="signupPasswordConfirm">تأكيد كلمة المرور</label><div class="password-wrap"><input class="input" id="signupPasswordConfirm" type="password" autocomplete="new-password" maxlength="128" placeholder="أعد كتابة كلمة المرور"><button type="button" data-toggle-password="signupPasswordConfirm" aria-label="إظهار تأكيد كلمة المرور">◉</button></div><small class="field-error" data-error-for="signupPasswordConfirm"></small></div>
          </div>
          <label class="terms-check"><input type="checkbox" id="signupTerms"><span>أوافق على <a href="/policies/terms" target="_blank">الشروط والأحكام</a> و<a href="/policies/privacy" target="_blank">سياسة الخصوصية</a>.</span></label>
          <small class="field-error" data-error-for="signupTerms"></small>
          <div class="signup-actions"><button class="outline-btn wide" type="button" id="signupBack">رجوع</button><button class="primary-btn wide" type="submit" id="signupSubmit">إنشاء حساب</button></div>
          <div class="signup-safe-note">بياناتك محمية ولا يتم تخزين كلمة المرور بصورتها الأصلية.</div>
        </section>
      </form>'''

SIGNUP_JS = r"""
  const signupCountries=[
    ['SY','🇸🇾','سوريا','963'],['TR','🇹🇷','تركيا','90'],['IQ','🇮🇶','العراق','964'],['SA','🇸🇦','السعودية','966'],['AE','🇦🇪','الإمارات','971'],['EG','🇪🇬','مصر','20'],['JO','🇯🇴','الأردن','962'],['LB','🇱🇧','لبنان','961'],['PS','🇵🇸','فلسطين','970'],['KW','🇰🇼','الكويت','965'],['QA','🇶🇦','قطر','974'],['BH','🇧🇭','البحرين','973'],['OM','🇴🇲','عُمان','968'],['YE','🇾🇪','اليمن','967'],['LY','🇱🇾','ليبيا','218'],['DZ','🇩🇿','الجزائر','213'],['MA','🇲🇦','المغرب','212'],['TN','🇹🇳','تونس','216'],['SD','🇸🇩','السودان','249'],['SO','🇸🇴','الصومال','252'],['MR','🇲🇷','موريتانيا','222'],['DE','🇩🇪','ألمانيا','49'],['FR','🇫🇷','فرنسا','33'],['NL','🇳🇱','هولندا','31'],['SE','🇸🇪','السويد','46'],['GB','🇬🇧','بريطانيا','44'],['US','🇺🇸','الولايات المتحدة','1'],['CA','🇨🇦','كندا','1']
  ];
  let signupStep=1;
  function selectedCountry(){return signupCountries.find(c=>c[0]===$('#signupCountry')?.value)}
  function setSignupStep(step){signupStep=step===2?2:1;$$('[data-signup-step]').forEach(x=>x.hidden=Number(x.dataset.signupStep)!==signupStep);$$('[data-progress]').forEach(x=>x.classList.toggle('active',Number(x.dataset.progress)<=signupStep));$('#authError').classList.remove('show');$('#signupForm')?.scrollIntoView({behavior:'smooth',block:'start'})}
  function clearFieldError(id){const input=$('#'+id),error=$(`[data-error-for="${id}"]`);input?.closest('.field')?.classList.remove('invalid');if(error)error.textContent=''}
  function fieldError(id,message){const input=$('#'+id),error=$(`[data-error-for="${id}"]`);input?.closest('.field')?.classList.add('invalid');if(error)error.textContent=message;return false}
  function cleanPhoneDigits(){const input=$('#signupPhone');if(!input)return'';input.value=input.value.replace(/\D/g,'').slice(0,15);return input.value}
  function fullPhone(){const country=selectedCountry(),digits=cleanPhoneDigits();if(!country)return'';let local=digits;while(local.startsWith('0'))local=local.slice(1);if(local.startsWith(country[3])&&local.length>country[3].length+6)local=local.slice(country[3].length);return `+${country[3]}${local}`}
  function validName(id,required=true){const value=$('#'+id).value.trim();if(!value&&!required)return true;if(value.length<2)return fieldError(id,'اكتب اسمًا صحيحًا من حرفين على الأقل.');if(!/[\p{L}]/u.test(value)||/[0-9]/.test(value))return fieldError(id,'الاسم يقبل الحروف والمسافات فقط.');return true}
  function validateSignupStepOne(){['firstName','lastName','signupCountry','signupPhone'].forEach(clearFieldError);let ok=validName('firstName',true);ok=validName('lastName',false)&&ok;if(!selectedCountry())ok=fieldError('signupCountry','اختر الدولة من القائمة.')&&ok;const phone=fullPhone();if(!/^\+[0-9]{8,15}$/.test(phone))ok=fieldError('signupPhone','أدخل رقم هاتف صحيحًا بعد اختيار الدولة.')&&ok;if(!ok){const first=$('#signupForm .field.invalid input, #signupForm .field.invalid select');first?.focus();first?.scrollIntoView({behavior:'smooth',block:'center'})}return ok}
  function usernameValid(value){return value.length>=3&&value.length<=35&&!/\s/u.test(value)&&/[\p{L}\p{N}]/u.test(value)&&/^[\p{L}\p{N}_.-]+$/u.test(value)}
  function passwordScore(value){let score=0;if(value.length>=8)score++;if(value.length>=12)score++;if(/[A-Z\u0621-\u064A]/u.test(value)&&/[a-z]/u.test(value))score++;if(/[0-9]/.test(value))score++;if(/[^A-Za-z0-9\u0600-\u06FF]/u.test(value))score++;return Math.min(4,score)}
  function updatePasswordStrength(){const value=$('#signupPassword')?.value||'',bar=$('#passwordStrengthBar');if(!bar)return;const score=passwordScore(value);bar.style.width=`${score*25}%`;bar.className=score>=4?'strong':score>=2?'medium':''}
  function validateSignupStepTwo(){['signupUsername','signupEmail','signupPassword','signupPasswordConfirm','signupTerms'].forEach(clearFieldError);let ok=true;const username=$('#signupUsername').value.trim();if(!usernameValid(username))ok=fieldError('signupUsername','اسم المستخدم من 3 إلى 35 محرفًا، دون مسافات، ويقبل العربي والإنكليزي والأرقام و _ - .')&&ok;const email=$('#signupEmail').value.trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))ok=fieldError('signupEmail','أدخل بريدًا إلكترونيًا صحيحًا.')&&ok;const password=$('#signupPassword').value;if(password.length<8)ok=fieldError('signupPassword','كلمة المرور يجب أن تكون 8 أحرف على الأقل.')&&ok;if($('#signupPasswordConfirm').value!==password)ok=fieldError('signupPasswordConfirm','كلمتا المرور غير متطابقتين.')&&ok;if(!$('#signupTerms').checked){const error=$('[data-error-for="signupTerms"]');if(error){error.textContent='يجب الموافقة على الشروط وسياسة الخصوصية.';error.style.display='block'}ok=false}else{const error=$('[data-error-for="signupTerms"]');if(error)error.style.display=''}if(!ok){const first=$('#signupForm .field.invalid input, #signupForm .field.invalid select');first?.focus();first?.scrollIntoView({behavior:'smooth',block:'center'})}return ok}
  function prepareSignupExperience(){const country=$('#signupCountry');if(!country)return;country.innerHTML='<option value="">اختر دولتك</option>'+signupCountries.map(c=>`<option value="${c[0]}">${c[1]} ${c[2]} (+${c[3]})</option>`).join('');country.onchange=()=>{clearFieldError('signupCountry');const c=selectedCountry();$('#signupPhoneCode').textContent=c?`+${c[3]}`:'+---';$('#signupPhone').placeholder=c?'رقم الهاتف المحلي':'اختر الدولة أولًا'};$('#signupPhone').oninput=()=>{cleanPhoneDigits();clearFieldError('signupPhone')};$('#signupNext').onclick=()=>{if(validateSignupStepOne())setSignupStep(2)};$('#signupBack').onclick=()=>setSignupStep(1);$('#signupPassword').oninput=()=>{clearFieldError('signupPassword');updatePasswordStrength()};$('#signupPasswordConfirm').oninput=()=>clearFieldError('signupPasswordConfirm');for(const id of ['firstName','lastName','signupUsername','signupEmail'])$('#'+id).addEventListener('input',()=>clearFieldError(id));$('#signupTerms').onchange=()=>{const error=$('[data-error-for="signupTerms"]');if(error){error.textContent='';error.style.display=''}};setSignupStep(1)}
  const originalShowAuthTab=showAuthTab;showAuthTab=function(name){originalShowAuthTab(name);if(name==='signup')setSignupStep(1)};
  submitSignup=async function(e){e.preventDefault();if(!validateSignupStepOne()){setSignupStep(1);return}if(!validateSignupStepTwo()){setSignupStep(2);return}const button=$('#signupSubmit');button.disabled=true;button.textContent='جاري إنشاء الحساب...';try{const country=selectedCountry();const data=await api('/v1/storefront/auth/signup',{method:'POST',body:JSON.stringify({first_name:$('#firstName').value.trim(),last_name:$('#lastName').value.trim(),username:$('#signupUsername').value.trim(),email:$('#signupEmail').value.trim(),country:country?country[2]:'',phone:fullPhone(),password:$('#signupPassword').value})});state.account=data.account;state.csrf=data.csrf_token;enterApp();toast('تم إنشاء حسابك بنجاح')}catch(err){authError(err.message);if(/اسم المستخدم/.test(err.message)){setSignupStep(2);fieldError('signupUsername',err.message)}else if(/البريد/.test(err.message)){setSignupStep(2);fieldError('signupEmail',err.message)}else if(/الهاتف|رقم/.test(err.message)){setSignupStep(1);fieldError('signupPhone',err.message)}}finally{button.disabled=false;button.textContent='إنشاء حساب'}};
  const originalBoot=boot;boot=async function(){prepareSignupExperience();return originalBoot()};
"""


def patch_signup_html(html: str) -> str:
    if "signupCountries=[" in html:
        return html
    if OLD_SIGNUP_FORM not in html:
        raise RuntimeError("Signup form marker was not found in storefront HTML")
    html = html.replace(OLD_SIGNUP_FORM, NEW_SIGNUP_FORM, 1)
    html = html.replace("  </style>", SIGNUP_CSS + "\n  </style>", 1)
    marker = "  boot();\n  </script>"
    if marker not in html:
        raise RuntimeError("Storefront boot marker was not found")
    return html.replace(marker, SIGNUP_JS + "\n  boot();\n  </script>", 1)


def install(api_module: Any) -> None:
    if getattr(api_module, "_storefront_signup_experience_installed", False):
        return
    core = api_module.core

    def storefront_username(value: str) -> str:
        try:
            return normalize_username(value)
        except ValueError as exc:
            raise core.StorefrontError("invalid_username", str(exc)) from exc

    core.normalize_username = storefront_username
    document = patch_signup_html(api_module._STOREFRONT_HTML)
    api_module._STOREFRONT_HTML = document
    try:
        import storefront_theme
        storefront_theme.STOREFRONT_HTML = document
    except ImportError:
        pass
    api_module._storefront_signup_experience_installed = True


__all__ = ["USERNAME_MESSAGE", "install", "normalize_username", "patch_signup_html"]
