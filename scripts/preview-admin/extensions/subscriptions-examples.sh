# Sourced by preview-admin.yml before Directus starts, from the repository root,
# with $URL the preview's public URL: what it exports reaches Directus.
#
# Loads @scalabus/subscriptions-examples next to the bundle, with fake Stripe
# and Mollie on localhost and a Mailpit for the mails.
#
# A run the repository's owner starts on one of its own branches also gets the
# real Stripe and Mollie test keys, and the webhook secrets of the endpoints
# preview-admin.yml created for this tunnel (PREVIEW_* below). The examples
# module's header then switches between the fakes and the real test mode.
# Every other run makes its keys up at boot and reaches no provider.

EXAMPLES_BUNDLE="$PWD/packages/core-extensions/subscriptions-examples"

if [ ! -f "$EXAMPLES_BUNDLE/dist/api.js" ] \
  || [ ! -e preview-extensions/node_modules/@scalabus/subscriptions ]; then
  echo "no subscriptions examples in this ref: not loaded"
  return 0
fi

ln -s "$EXAMPLES_BUNDLE" \
  preview-extensions/node_modules/@scalabus/subscriptions-examples
jq '.dependencies["@scalabus/subscriptions-examples"] = "0.1.0"' \
  preview-extensions/package.json > /tmp/preview-extensions.json
mv /tmp/preview-extensions.json preview-extensions/package.json

export SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS=true
export SUBSCRIPTIONS_EXAMPLES_PROVIDERS_PORT=8057

if [[ "${PREVIEW_STRIPE_SECRET_KEY:-}" =~ ^sk_test_ ]] \
  && [[ "${PREVIEW_MOLLIE_API_KEY:-}" =~ ^test_ ]] \
  && [ -n "${PREVIEW_STRIPE_WEBHOOK_SECRET:-}" ] \
  && [ -n "${PREVIEW_MOLLIE_WEBHOOK_SECRET:-}" ]; then
  # The fakes sign their webhooks with these same secrets.
  export SUBSCRIPTIONS_EXAMPLES_REAL_PROVIDERS=true
  export SUBSCRIPTIONS_STRIPE_SECRET_KEY="$PREVIEW_STRIPE_SECRET_KEY"
  export SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET="$PREVIEW_STRIPE_WEBHOOK_SECRET"
  export SUBSCRIPTIONS_MOLLIE_API_KEY="$PREVIEW_MOLLIE_API_KEY"
  export SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS="$PREVIEW_MOLLIE_WEBHOOK_SECRET"
  echo "subscriptions examples: real Stripe and Mollie test mode available"

  # Stripe's in-page form mounts from the publishable key; none, the hosted
  # page. The fakes refuse the in-page form, so their checkouts get the pay page.
  if [[ "${PREVIEW_STRIPE_PUBLISHABLE_KEY:-}" =~ ^pk_test_ ]]; then
    export SUBSCRIPTIONS_CHECKOUT_UI=in_page
    export SUBSCRIPTIONS_STRIPE_PUBLISHABLE_KEY="$PREVIEW_STRIPE_PUBLISHABLE_KEY"
  else
    export SUBSCRIPTIONS_CHECKOUT_UI=hosted
    echo "subscriptions examples: no PREVIEW_STRIPE_PUBLISHABLE_KEY, hosted checkout"
  fi
else
  export SUBSCRIPTIONS_EXAMPLES_REAL_PROVIDERS=false
  export SUBSCRIPTIONS_STRIPE_SECRET_KEY="sk_test_examples_$(openssl rand -hex 12)"
  export SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET="whsec_$(openssl rand -hex 24)"
  export SUBSCRIPTIONS_MOLLIE_API_KEY="test_$(openssl rand -hex 15)"
  export SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS="$(openssl rand -hex 24)"
  # The fakes have only their pay page.
  export SUBSCRIPTIONS_CHECKOUT_UI=hosted
  echo "subscriptions examples: fake providers only, no real test keys"
fi
unset PREVIEW_STRIPE_SECRET_KEY PREVIEW_MOLLIE_API_KEY
export SUBSCRIPTIONS_CHECKOUT_URL_ALLOW_LIST="$URL/admin/subscriptions-examples,http://localhost:8055/admin/subscriptions-examples"

docker run -d --name preview-mailpit --network host axllent/mailpit:v1.34.0
export EMAIL_TRANSPORT=smtp
export EMAIL_SMTP_HOST=127.0.0.1
export EMAIL_SMTP_PORT=1025
export EMAIL_SMTP_SECURE=false
export EMAIL_SMTP_IGNORE_TLS=true

# The examples' plans and tester, the way production migrates a bundle.
PACKAGE_FILE_LOCATION="$PWD/preview-extensions" \
  node directus/cli.js database migrate:latest

# One process, out of the Directus cluster: every worker reads the payments a
# checkout created there.
PUBLIC_URL="$URL" pm2 start "$EXAMPLES_BUNDLE/fake-providers/serve-fake-providers.mjs" \
  --name fake-providers \
  --output /tmp/directus.log \
  --error /tmp/directus.log

echo "subscriptions examples loaded: sign in as tester@example.com / tester"
