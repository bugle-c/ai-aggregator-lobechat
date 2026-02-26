import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      YOOKASSA_SECRET_KEY?: string;
      YOOKASSA_SHOP_ID?: string;
    }
  }
}

export const getBillingConfig = () => {
  return createEnv({
    client: {},
    server: {
      YOOKASSA_SHOP_ID: z.string().optional(),
      YOOKASSA_SECRET_KEY: z.string().optional(),
    },
    runtimeEnv: {
      YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID,
      YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY,
    },
  });
};

export const billingEnv = getBillingConfig();
