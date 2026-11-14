import { testimonies } from "@/data/testimonies";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm font-medium text-stone-500">開發預覽 · 範例內容</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        故事，陪你走一段路
      </h1>
      <p className="mt-4 leading-7 text-stone-600">
        這是開發用的示意頁面。以下故事均為虛構，尚未連結真實內容。
      </p>
      <section aria-label="示範故事" className="mt-10 space-y-4">
        {testimonies.map((story) => (
          <article
            key={story.id}
            className="rounded-xl border border-stone-200 bg-white p-6"
          >
            <p className="text-sm text-stone-500">{story.source}</p>
            <h2 className="mt-2 text-xl font-semibold">{story.title}</h2>
            <p className="mt-3 leading-7 text-stone-600">{story.preview}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
