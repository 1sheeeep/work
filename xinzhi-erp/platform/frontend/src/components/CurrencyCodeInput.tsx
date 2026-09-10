import type { InputHTMLAttributes } from "react";

type CurrencyCodeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "list"> & {
  listId: string;
};

const commonCurrencies = [
  { code: "CNY", label: "人民币（CNY）" },
  { code: "USD", label: "美元（USD）" },
  { code: "EUR", label: "欧元（EUR）" },
  { code: "GBP", label: "英镑（GBP）" },
  { code: "HKD", label: "港元（HKD）" },
  { code: "JPY", label: "日元（JPY）" },
  { code: "CAD", label: "加拿大元（CAD）" },
  { code: "AUD", label: "澳大利亚元（AUD）" },
  { code: "SGD", label: "新加坡元（SGD）" },
  { code: "KRW", label: "韩元（KRW）" },
  { code: "TWD", label: "新台币（TWD）" },
  { code: "THB", label: "泰铢（THB）" },
  { code: "MYR", label: "马来西亚林吉特（MYR）" },
  { code: "IDR", label: "印尼盾（IDR）" },
  { code: "PHP", label: "菲律宾比索（PHP）" },
  { code: "VND", label: "越南盾（VND）" },
  { code: "INR", label: "印度卢比（INR）" },
  { code: "AED", label: "阿联酋迪拉姆（AED）" },
  { code: "SAR", label: "沙特里亚尔（SAR）" },
  { code: "BRL", label: "巴西雷亚尔（BRL）" },
  { code: "MXN", label: "墨西哥比索（MXN）" },
  { code: "PLN", label: "波兰兹罗提（PLN）" },
  { code: "TRY", label: "土耳其里拉（TRY）" },
  { code: "ZAR", label: "南非兰特（ZAR）" },
] as const;

/**
 * Keeps the API's ISO-code contract open while making the common choices
 * discoverable in native browser controls.
 */
export function CurrencyCodeInput({
  listId,
  placeholder = "选择或输入 ISO 三位币种",
  ...inputProps
}: CurrencyCodeInputProps) {
  return (
    <>
      <input
        {...inputProps}
        autoComplete="off"
        list={listId}
        maxLength={3}
        pattern="[A-Za-z]{3}"
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {commonCurrencies.map((currency) => (
          <option key={currency.code} value={currency.code} label={currency.label} />
        ))}
      </datalist>
    </>
  );
}
