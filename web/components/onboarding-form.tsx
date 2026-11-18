"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { profileInputSchema, type ProfileInput } from "@/lib/contracts";
import { useFeedSession } from "./feed-session-provider";
import { dismissWelcome } from "./welcome-prompt";

type Age = NonNullable<ProfileInput["ageRange"]> | "";
type Gender = NonNullable<ProfileInput["gender"]> | "";

export function OnboardingForm() {
  const router = useRouter();
  const { saveOnboarding, dataSource } = useFeedSession();
  const [description, setDescription] = useState("");
  const [age, setAge] = useState<Age>("");
  const [gender, setGender] = useState<Gender>("");
  const [storePreferences, setStorePreferences] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stillOnForm = useRef(true);

  useEffect(() => {
    stillOnForm.current = true;
    return () => {
      stillOnForm.current = false;
    };
  }, []);

  function leaveForm() {
    // A response must not redirect someone who already chose another page.
    stillOnForm.current = false;
  }

  function skip() {
    leaveForm();
    dismissWelcome();
    router.replace("/");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const result = profileInputSchema.safeParse({
      description: description.trim() || null,
      topics: [],
      ...(age ? { ageRange: age } : {}),
      ...(gender ? { gender } : {}),
      consentStorePreferences: storePreferences,
      // The application does not offer raw-text retention.
      consentKeepText: false,
    });
    if (!result.success) {
      setError("請確認輸入內容不超過 2,000 字。");
      return;
    }

    setBusy(true);
    try {
      const response = await saveOnboarding(result.data);
      if (!stillOnForm.current) return;
      // Never keep the voluntary description in a client-side cache or browser
      // storage after submission, including when support is recommended.
      setDescription("");
      dismissWelcome();
      if (
        response.feedMode === "support" ||
        response.safetyState === "support"
      ) {
        router.replace("/support");
      } else {
        router.replace("/");
      }
    } catch {
      // Never reflect server error bodies, raw inputs or stack traces into UI.
      if (stillOnForm.current) {
        setError("目前無法完成設定。你可以重試，或直接探索故事。");
      }
    } finally {
      if (stillOnForm.current) setBusy(false);
    }
  }

  return (
    <form
      className="onboarding-form"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div className="onboarding-form-intro">
        <p className="onboarding-kicker">01 / 你的故事，從這裡開始</p>
        <h1>最近，有什麼放在心上？</h1>
        <p>不需要寫得完整，也沒有標準答案。所有欄位都可以留白。</p>
      </div>

      <div className="onboarding-primary-field">
        <label className="onboarding-label" htmlFor="personal-description">
          想分享的近況 <span>選填</span>
        </label>
        <p className="onboarding-field-hint" id="description-hint">
          例如：「剛搬到新城市，偶爾會覺得孤單」或「正在思考下一份工作」。
        </p>
        <textarea
          id="personal-description"
          className="onboarding-textarea"
          data-testid="personal-description"
          aria-describedby="description-hint description-count"
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={5}
          placeholder="寫幾句最近的心情，或你在意的事情…"
          disabled={busy}
        />
        <p className="onboarding-count" id="description-count">
          {description.length} / 2,000 字
        </p>
      </div>

      <div className="onboarding-demographics">
        <div className="onboarding-select-group">
          <label className="onboarding-label" htmlFor="age-range">
            年齡區間 <span>選填</span>
          </label>
          <select
            id="age-range"
            className="onboarding-select"
            value={age}
            onChange={(event) => setAge(event.target.value as Age)}
            disabled={busy}
          >
            <option value="">不填寫</option>
            <option value="18-24">18–24 歲</option>
            <option value="25-34">25–34 歲</option>
            <option value="35-44">35–44 歲</option>
            <option value="45-54">45–54 歲</option>
            <option value="55-64">55–64 歲</option>
            <option value="65+">65 歲以上</option>
            <option value="prefer_not_to_say">不方便透露</option>
          </select>
        </div>
        <div className="onboarding-select-group">
          <label className="onboarding-label" htmlFor="gender">
            性別 <span>選填</span>
          </label>
          <select
            id="gender"
            className="onboarding-select"
            value={gender}
            onChange={(event) => setGender(event.target.value as Gender)}
            disabled={busy}
          >
            <option value="">不填寫</option>
            <option value="woman">女性</option>
            <option value="man">男性</option>
            <option value="nonbinary">非二元性別</option>
            <option value="prefer_not_to_say">不方便透露</option>
          </select>
        </div>
      </div>
      <p className="onboarding-demographic-note">
        年齡與性別不參與本階段的推薦排序。
      </p>

      <section className="onboarding-privacy" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">關於你的分享</h2>
        <p>
          正式服務會在自己的伺服器處理你分享的文字，用於尋找相關見證，
          不會送至外部 AI 推論服務。預設不保留原文，也不會將文字送往分析工具。
        </p>
        <label className="onboarding-consent">
          <input
            type="checkbox"
            checked={storePreferences}
            onChange={(event) => setStorePreferences(event.target.checked)}
            disabled={busy}
          />
          <span>
            <strong>記住我的匿名偏好</strong>
            <small>
              選填。允許下次使用時沿用偏好資訊；即使勾選，也不會儲存這段原始文字。
            </small>
          </span>
        </label>
        {dataSource === "mock" ? (
          <p className="onboarding-demo-note">
            開發示範：目前只使用暫存的示意資料，不會跨次保留偏好，也不會實際分析文字內容。
          </p>
        ) : null}
      </section>

      {error ? (
        <div
          className="onboarding-error"
          role="alert"
          data-testid="onboarding-error"
        >
          {error}
        </div>
      ) : null}
      <div className="onboarding-actions">
        <button
          className="ui-button ui-button--primary"
          type="submit"
          disabled={busy}
          data-testid="show-my-feed"
        >
          {busy ? "正在準備故事…" : "看看我的故事推薦"}
        </button>
        <button
          className="ui-button ui-button--quiet"
          type="button"
          onClick={skip}
          disabled={busy}
        >
          略過，直接探索
        </button>
      </div>
      <div className="onboarding-footer-links">
        <Link href="/support" onClick={leaveForm}>
          現在需要幫助？
        </Link>
        <Link href="/" onClick={leaveForm}>
          返回故事動態
        </Link>
      </div>
    </form>
  );
}
