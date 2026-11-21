# Sourced by preview-admin.yml before Directus starts, from the repository root,
# with $URL the preview's public URL: what it exports reaches Directus.
#
# Loads @scalabus/subscriptions-examples next to the bundle, with fake Stripe
# and Mollie on localhost and a Mailpit for the mails. Every key below is made
# up at boot: this job runs the PR head and gets no secret, so no provider and
# no mailbox outside the runner is ever reached.

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
export SUBSCRIPTIONS_STRIPE_SECRET_KEY="sk_test_examples_$(openssl rand -hex 12)"
export SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET="whsec_$(openssl rand -hex 24)"
export SUBSCRIPTIONS_MOLLIE_API_KEY="test_$(openssl rand -hex 15)"
export SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS="$(openssl rand -hex 24)"
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
