import Link from "next/link";

export default function NotFound() {
  return (
    <main className="notFoundPage" role="main" aria-live="polite">
      <section className="notFoundCard">
        <p className="notFoundCode">404</p>
        <h1 className="glitchTitle" data-text="Page not found">
          Page not found
        </h1>
        <p>
          The page you requested does not exist. Check the URL or return to the review dashboard.
        </p>
        <Link href="/" className="primaryButton">
          Go to dashboard
        </Link>
      </section>
    </main>
  );
}
