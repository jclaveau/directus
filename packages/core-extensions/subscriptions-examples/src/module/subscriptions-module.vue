<script setup lang="ts">
import { useApi } from '@directus/extensions-sdk';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
	composePlanLine,
	composeSubscriptionLines,
	type ExamplesPlan,
	isLiveSubscription,
	isManaged,
	type MineSubscription,
	NO_SUBSCRIPTION_LINE,
	normalizeCustomAmount,
} from './compose-module-lines.js';

const PLAN_CODES = ['basic', 'team', 'yearly'];

const REFRESH_MILLISECONDS = 1500;

// The extensions SDK cannot bundle an SFC <style> block, so the module styles
// its elements inline, from Directus's own theme variables.
const MODULE_STYLES = {
	headerIcon: {
		'--v-button-background-color-disabled': 'var(--theme--primary-background)',
		'--v-button-color-disabled': 'var(--theme--primary)',
	},
	modulePage: {
		display: 'flex',
		flexDirection: 'column',
		gap: '20px',
		maxWidth: '960px',
		padding: 'var(--content-padding)',
		paddingBottom: 'var(--content-padding-bottom)',
	},
	planGrid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
		gap: '20px',
	},
	cardBox: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
		padding: '20px',
		border: 'var(--theme--border-width) solid'
			+ ' var(--theme--form--field--input--border-color)',
		borderRadius: 'var(--theme--border-radius)',
		backgroundColor: 'var(--theme--background-subdued)',
	},
	cardTitle: {
		color: 'var(--theme--foreground-accent)',
		fontWeight: '600',
		fontSize: '18px',
	},
	actionRow: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: '8px',
	},
	beneficiaryRow: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
	},
	growingCell: { flex: '1 1 200px' },
	providersSwitch: {
		display: 'flex',
		alignItems: 'center',
		gap: '4px',
	},
} as const;

type ProvidersMode = 'fake' | 'real';

const PROVIDERS_SWITCH = [
	{ mode: 'fake', icon: 'science', label: 'Fake providers' },
	{ mode: 'real', icon: 'public', label: 'Real (test mode)' },
] as const;

const directusApi = useApi();

const examplesPlans = ref<ExamplesPlan[]>([]);
const mineSubscriptions = ref<MineSubscription[]>([]);
const customAmounts = ref<Record<string, string>>({});
const beneficiaryEmails = ref<Record<number, string>>({});
const moduleError = ref<string | null>(null);
const isLoaded = ref(false);
const providersMode = ref<ProvidersMode | null>(null);
const isRealAvailable = ref(false);

const providersTooltip = computed(() => {
	return isRealAvailable.value
		? 'Real: Stripe and Mollie in test mode, their own checkout pages, no'
		+ ' money moves. Fake: this preview\'s own pay page.'
		: 'This preview has no real Stripe and Mollie test keys: only a run the'
		+ ' repository\'s owner starts on one of its own branches gets them.';
});

let refreshTimer: ReturnType<typeof setInterval> | undefined;

const liveSubscriptions = computed(() => {
	const checkedAt = new Date();

	return mineSubscriptions.value.filter((mineSubscription) => {
		return isLiveSubscription(mineSubscription, checkedAt);
	});
});

function findPlan(planCode: string): ExamplesPlan | undefined {
	return examplesPlans.value.find((examplesPlan) => {
		return examplesPlan.code === planCode;
	});
}

function readErrorMessage(requestError: unknown): string {
	const responseErrors = (requestError as {
		response?: { data?: { errors?: { message: string }[] } };
	}).response?.data?.errors;

	return responseErrors?.[0]?.message ?? String(requestError);
}

async function loadSubscriptions(): Promise<void> {
	const [plansResponse, mineResponse] = await Promise.all([
		directusApi.get('/items/subscription_plans', {
			params: {
				fields: 'code,name,amount,currency,interval,beneficiaries_max',
				filter: { code: { _in: PLAN_CODES } },
				sort: 'amount',
			},
		}),
		directusApi.get('/subscriptions/mine'),
	]);

	examplesPlans.value = plansResponse.data.data;
	mineSubscriptions.value = mineResponse.data.data;
	isLoaded.value = true;
}

type ProvidersModeAnswer = { mode: ProvidersMode; real_available: boolean };

function storeProvidersMode(modeAnswer: ProvidersModeAnswer): void {
	providersMode.value = modeAnswer.mode;
	isRealAvailable.value = modeAnswer.real_available;
}

async function loadProvidersMode(): Promise<void> {
	const modeResponse = await directusApi.get(
		'/subscriptions-examples/providers-mode',
	);

	storeProvidersMode(modeResponse.data.data);
}

function pickProvidersMode(pickedMode: ProvidersMode): Promise<void> {
	return runAction(async () => {
		const modeResponse = await directusApi.put(
			'/subscriptions-examples/providers-mode',
			{ mode: pickedMode },
		);

		storeProvidersMode(modeResponse.data.data);
	});
}

async function runAction(moduleAction: () => Promise<unknown>): Promise<void> {
	moduleError.value = null;

	try {
		await moduleAction();
		await loadSubscriptions();
	}
	catch (requestError) {
		moduleError.value = readErrorMessage(requestError);
	}
}

function subscribePlan(planCode: string, providerName: string): Promise<void> {
	return runAction(async () => {
		const customAmount = normalizeCustomAmount(
			customAmounts.value[planCode] ?? '',
		);

		const checkoutResponse = await directusApi.post('/subscriptions/checkout', {
			plan: planCode,
			provider: providerName,
			...customAmount === ''
? {}
: { custom_amount: customAmount },
			redirect_url: window.location.href,
		});

		window.location.assign(checkoutResponse.data.data.url);
	});
}

function addBeneficiary(subscriptionId: number): Promise<void> {
	return runAction(async () => {
		await directusApi.post('/subscriptions/beneficiaries', {
			subscription: subscriptionId,
			email: beneficiaryEmails.value[subscriptionId]?.trim() ?? '',
		});

		beneficiaryEmails.value[subscriptionId] = '';
	});
}

function removeBeneficiary(
	subscriptionId: number,
	beneficiaryEmail: string,
): Promise<void> {
	return runAction(() => {
		return directusApi.delete('/items/subscription_beneficiaries', {
			data: {
				query: {
					filter: {
						subscription: { _eq: subscriptionId },
						user: { email: { _eq: beneficiaryEmail } },
					},
				},
			},
		});
	});
}

function changeRenewal(
	subscriptionId: number,
	renewalAction: 'cancel' | 'resume',
): Promise<void> {
	return runAction(() => {
		return directusApi.post(`/subscriptions/${renewalAction}`, {
			subscription: subscriptionId,
		});
	});
}

onMounted(() => {
	runAction(loadProvidersMode);

	// The webhooks land after the pay page redirected here, and the bundle
	// syncs them in the background.
	refreshTimer = setInterval(() => {
		loadSubscriptions()
			.catch((refreshError: unknown) => {
				moduleError.value = readErrorMessage(refreshError);
			});
	}, REFRESH_MILLISECONDS);
});

onUnmounted(() => {
	clearInterval(refreshTimer);
});
</script>

<template>
  <private-view title="Subscriptions">
    <template #title-outer:prepend>
      <v-button
        rounded
        :style="MODULE_STYLES.headerIcon"
        icon
        exact
        disabled
      >
        <v-icon name="card_membership" />
      </v-button>
    </template>

    <template #actions>
      <div
        v-if="providersMode !== null"
        v-tooltip.bottom="providersTooltip"
        class="examples-providers-switch"
        :style="MODULE_STYLES.providersSwitch"
      >
        <v-button
          v-for="switchOption in PROVIDERS_SWITCH"
          :key="switchOption.mode"
          small
          :secondary="providersMode !== switchOption.mode"
          :disabled="switchOption.mode === 'real' && !isRealAvailable"
          @click="pickProvidersMode(switchOption.mode)"
        >
          <v-icon
            :name="switchOption.icon"
            left
          />
          {{ switchOption.label }}
        </v-button>
      </div>
    </template>

    <div
      class="examples-module"
      :style="MODULE_STYLES.modulePage"
    >
      <v-notice
        v-if="moduleError !== null"
        type="danger"
      >
        <span class="examples-error">{{ moduleError }}</span>
      </v-notice>

      <template v-if="isLoaded && liveSubscriptions.length === 0">
        <div
          class="examples-plans"
          :style="MODULE_STYLES.planGrid"
        >
          <div
            v-for="examplesPlan in examplesPlans"
            :key="examplesPlan.code"
            class="examples-plan"
            :style="MODULE_STYLES.cardBox"
            :data-plan="examplesPlan.code"
          >
            <p
              class="examples-line"
              :style="MODULE_STYLES.cardTitle"
            >
              {{ composePlanLine(examplesPlan) }}
            </p>
            <v-input
              v-model="customAmounts[examplesPlan.code]"
              :aria-label="`Amount for ${examplesPlan.name}`"
              placeholder="Amount (optional)"
              inputmode="decimal"
              small
            />
            <div :style="MODULE_STYLES.actionRow">
              <v-button
                small
                @click="subscribePlan(examplesPlan.code, 'mollie')"
              >
                Subscribe with Mollie
              </v-button>
              <v-button
                small
                secondary
                @click="subscribePlan(examplesPlan.code, 'stripe')"
              >
                Subscribe with Stripe
              </v-button>
            </div>
          </div>
        </div>
        <v-notice type="info">
          <span class="examples-line">{{ NO_SUBSCRIPTION_LINE }}</span>
        </v-notice>
      </template>

      <div
        v-for="mineSubscription in liveSubscriptions"
        :key="mineSubscription.id"
        class="examples-subscription"
        :style="MODULE_STYLES.cardBox"
      >
        <p
          v-for="(subscriptionLine, lineIndex) in composeSubscriptionLines(
            mineSubscription,
            findPlan(mineSubscription.plan.code),
          )"
          :key="subscriptionLine"
          class="examples-line"
          :style="lineIndex === 0
            ? MODULE_STYLES.cardTitle
            : undefined"
        >
          {{ subscriptionLine }}
        </p>

        <template v-if="isManaged(mineSubscription)">
          <div :style="MODULE_STYLES.actionRow">
            <v-button
              v-if="mineSubscription.cancel_at_period_end"
              small
              secondary
              @click="changeRenewal(mineSubscription.id, 'resume')"
            >
              <v-icon
                name="autorenew"
                left
              />
              Resume subscription
            </v-button>
            <v-button
              v-else
              small
              kind="danger"
              secondary
              @click="changeRenewal(mineSubscription.id, 'cancel')"
            >
              <v-icon
                name="event_busy"
                left
              />
              Cancel at period end
            </v-button>
          </div>

          <div
            v-for="beneficiaryEmail in mineSubscription.beneficiaries ?? []"
            :key="beneficiaryEmail"
            class="examples-beneficiary"
            :style="MODULE_STYLES.beneficiaryRow"
          >
            <v-icon
              name="person"
              small
            />
            <span
              class="examples-line"
              :style="{ flex: 1 }"
            >{{ beneficiaryEmail }}</span>
            <v-button
              x-small
              secondary
              @click="removeBeneficiary(mineSubscription.id, beneficiaryEmail)"
            >
              Remove
            </v-button>
          </div>

          <div :style="MODULE_STYLES.actionRow">
            <div :style="MODULE_STYLES.growingCell">
              <v-input
                v-model="beneficiaryEmails[mineSubscription.id]"
                aria-label="Beneficiary email"
                placeholder="friend@example.com"
                type="email"
                small
              />
            </div>
            <v-button
              small
              @click="addBeneficiary(mineSubscription.id)"
            >
              Add
            </v-button>
          </div>
        </template>
      </div>
    </div>
  </private-view>
</template>

