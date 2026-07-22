"use client";

import { useMemo } from "react";

type Props = {
  href?: string;
  onClick?: () => void;
  size?: "md" | "lg";
  fullWidth?: boolean;
  className?: string;
};

export function SignInWithFailure({
  href,
  onClick,
  size = "lg",
  fullWidth,
  className = "",
}: Props) {
  const classes = useMemo(
    () =>
      [
        "failure-signin-btn",
        size === "lg" ? "failure-signin-btn--lg" : "failure-signin-btn--md",
        fullWidth ? "failure-signin-btn--block" : "",
        className,
      ]
        .filter(Boolean)
        .join(" "),
    [size, fullWidth, className],
  );

  const content = (
    <>
      <span className="failure-signin-btn__mark" aria-hidden>
        <span className="failure-signin-btn__ember" />
      </span>
      <span className="failure-signin-btn__label">Sign in with Failure</span>
    </>
  );

  if (href) {
    return (
      <a className={classes} href={href}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={classes} onClick={onClick}>
      {content}
    </button>
  );
}

export function FailureButtonCard({
  authorizeUrl = "/oauth/authorize",
}: {
  authorizeUrl?: string;
}) {
  return (
    <div className="failure-button-card">
      <div className="failure-button-card__glow" aria-hidden />
      <p className="failure-button-card__eyebrow">Universal UI format</p>
      <h3 className="failure-button-card__title">Sign in with Failure</h3>
      <p className="failure-button-card__copy">
        Drop this frosted glass button into any app. It starts Failure PKCE
        OAuth and returns connected Codex, ChatGPT, Claude Code, Grok Build,
        and Cursor credentials through userinfo.
      </p>
      <div className="failure-button-card__stage">
        <SignInWithFailure href={authorizeUrl} />
      </div>
      <code className="failure-button-card__snippet">
        {`<link rel="stylesheet" href="/sdk/sign-in-with-failure.css" />
<script src="/sdk/sign-in-with-failure.js"></script>
<div data-failure-signin data-client-id="YOUR_CLIENT_ID"></div>`}
      </code>
    </div>
  );
}
