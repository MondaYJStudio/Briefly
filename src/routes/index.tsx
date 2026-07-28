import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
      <section aria-labelledby="briefly-title" className="space-y-4">
        <p className="text-sm font-medium tracking-wide text-default-500 uppercase">
          Publication system
        </p>
        <h1
          id="briefly-title"
          className="text-4xl font-semibold tracking-tight"
        >
          Briefly
        </h1>
        <p className="max-w-xl text-lg text-default-600">
          A compact Cloudflare-native home for durable articles and immutable
          publications.
        </p>
      </section>
    </main>
  );
}
