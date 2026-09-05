from pathlib import Path
import re
p=Path('android/handoff/client/src/main/java/com/gamezone/store/MainActivity.java')
s=p.read_text()
pattern=r'''    new AlertDialog\.Builder\(this\)\.setView\(w\).*?\n  \}\n  void purchase'''
replacement=r'''    AlertDialog productDialog=new AlertDialog.Builder(this).setView(w).setNegativeButton("إلغاء",null).setPositiveButton("شراء",null).create();
    productDialog.setOnShowListener(d->{
      productDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
        try{
          JSONObject cd=new JSONObject();
          if(schema!=null)for(int i=0;i<schema.length();i++){
            JSONObject f=schema.getJSONObject(i);String key=f.optString("key"),val=fields.get(key).getText().toString().trim();
            if(f.optBoolean("required")&&val.isEmpty()){toast("أدخل "+f.optString("label",key));return;}
            if(!val.isEmpty())cd.put(key,val);
          }
          productDialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
          purchase(p,cd,coupon.getText().toString().trim(),productDialog);
        }catch(Exception e){toast("تحقق من بيانات الطلب");}
      });
    });
    productDialog.show();
  }
  void purchase'''
s2,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'product dialog patch count={n}')
p.write_text(s2)
print('native Android v3 compile fix applied')
