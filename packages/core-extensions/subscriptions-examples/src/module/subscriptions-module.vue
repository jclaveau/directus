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
} from './compose-module-lines.js';

const PLAN_CODES = ['basic', 'team', 'yearly'];

const REFRESH_MILLISECONDS = 1500;

const directusApi = useApi();

const examplesPlans = ref<ExamplesPlan[]>([]);
const mineSubscriptions = ref<MineSubscription[]>([]);
const customAmounts = ref<Record<string, string>>({});
const beneficiaryEmails = ref<Record<number, string>>({});
const moduleError = ref<string | null>(null);
const isLoaded = ref(false);

let refreshTimer: ReturnType<typeof setInterval> | undefined;

const liveSubscriptions = computed(() => {
	return mineSubscriptions.value.filter(isLiveSubscription);
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
		const customAmount = customAmounts.value[planCode]?.trim() ?? '';

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
	runAction(() => Promise.resolve());

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
    <div
      class="examples-module"
      style="padding: var(--content-padding)"
    >
      <p
        v-if="moduleError !== null"
        class="examples-error"
        style="color: var(--theme--danger)"
      >
        {{ moduleError }}
      </p>

      <template v-if="isLoaded && liveSubscriptions.length === 0">
        <div
          v-for="examplesPlan in examplesPlans"
          :key="examplesPlan.code"
          class="examples-plan"
          :data-plan="examplesPlan.code"
        >
          <p class="examples-line">
            {{ composePlanLine(examplesPlan) }}
          </p>
          <input
            v-model="customAmounts[examplesPlan.code]"
            :aria-label="`Amount for ${examplesPlan.name}`"
            placeholder="Amount (optional)"
            inputmode="decimal"
          >
          <button @click="subscribePlan(examplesPlan.code, 'mollie')">
            Subscribe with Mollie
          </button>
          <button @click="subscribePlan(examplesPlan.code, 'stripe')">
            Subscribe with Stripe
          </button>
        </div>
        <p class="examples-line">
          {{ NO_SUBSCRIPTION_LINE }}
        </p>
      </template>

      <div
        v-for="mineSubscription in liveSubscriptions"
        :key="mineSubscription.id"
        class="examples-subscription"
      >
        <p
          v-for="subscriptionLine in composeSubscriptionLines(
            mineSubscription,
            findPlan(mineSubscription.plan.code),
          )"
          :key="subscriptionLine"
          class="examples-line"
        >
          {{ subscriptionLine }}
        </p>

        <template v-if="isManaged(mineSubscription)">
          <div
            v-for="beneficiaryEmail in mineSubscription.beneficiaries ?? []"
            :key="beneficiaryEmail"
            class="examples-beneficiary"
          >
            <span class="examples-line">{{ beneficiaryEmail }}</span>
            <button
              @click="removeBeneficiary(mineSubscription.id, beneficiaryEmail)"
            >
              Remove
            </button>
          </div>

          <div class="examples-controls">
            <input
              v-model="beneficiaryEmails[mineSubscription.id]"
              aria-label="Beneficiary email"
              placeholder="friend@example.com"
              type="email"
            >
            <button @click="addBeneficiary(mineSubscription.id)">
              Add
            </button>
            <button
              v-if="mineSubscription.cancel_at_period_end"
              @click="changeRenewal(mineSubscription.id, 'resume')"
            >
              Resume
            </button>
            <button
              v-else
              @click="changeRenewal(mineSubscription.id, 'cancel')"
            >
              Cancel
            </button>
          </div>
        </template>
      </div>
    </div>
  </private-view>
</template>

