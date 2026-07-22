(function () {
  function base64Url(bytes) {
    var str = "";
    bytes.forEach(function (b) {
      str += String.fromCharCode(b);
    });
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomVerifier() {
    var bytes = crypto.getRandomValues(new Uint8Array(32));
    return base64Url(bytes);
  }

  function sha256(verifier) {
    return crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(verifier))
      .then(function (digest) {
        return base64Url(new Uint8Array(digest));
      });
  }

  function buildButton(el) {
    var clientId = el.getAttribute("data-client-id");
    var redirectUri =
      el.getAttribute("data-redirect-uri") || window.location.origin + "/callback";
    var authorizeBase =
      el.getAttribute("data-authorize-url") ||
      (el.getAttribute("data-failure-origin") || "") + "/oauth/authorize";
    var scope =
      el.getAttribute("data-scope") ||
      "openid profile email providers offline_access";

    el.innerHTML =
      '<a class="failure-signin-btn" href="#">' +
      '<span class="failure-signin-btn__mark" aria-hidden="true"><span class="failure-signin-btn__ember"></span></span>' +
      '<span class="failure-signin-btn__label">Sign in with Failure</span>' +
      "</a>";

    var anchor = el.querySelector("a");
    anchor.addEventListener("click", function (event) {
      event.preventDefault();
      if (!clientId) {
        console.error("[Failure OAuth] data-client-id is required");
        return;
      }
      var verifier = randomVerifier();
      var state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
      sha256(verifier).then(function (challenge) {
        sessionStorage.setItem(
          "failure_oauth_" + clientId,
          JSON.stringify({ verifier: verifier, state: state }),
        );
        var url = new URL(authorizeBase, window.location.origin);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("scope", scope);
        url.searchParams.set("state", state);
        url.searchParams.set("code_challenge", challenge);
        url.searchParams.set("code_challenge_method", "S256");
        window.location.href = url.toString();
      });
    });
  }

  function mount() {
    document
      .querySelectorAll("[data-failure-signin]")
      .forEach(function (node) {
        buildButton(node);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  window.FailureOAuth = {
    remount: mount,
    getStoredPkce: function (clientId) {
      try {
        return JSON.parse(
          sessionStorage.getItem("failure_oauth_" + clientId) || "null",
        );
      } catch {
        return null;
      }
    },
  };
})();
