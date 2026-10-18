import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isoDateString = z
  .string()
  .regex(ISO_DATE_RE, 'Date must be in YYYY-MM-DD format');

function validateDateRangeObject(
  val: {
    startDate: string;
    endDate: string;
    compareStartDate?: string;
    compareEndDate?: string;
  },
  ctx: z.RefinementCtx
) {
  if (val.startDate > val.endDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['startDate'],
      message: 'startDate must be on or before endDate.',
    });
  }
  const hasCompareStart = val.compareStartDate !== undefined && val.compareStartDate !== '';
  const hasCompareEnd = val.compareEndDate !== undefined && val.compareEndDate !== '';

  if (hasCompareStart !== hasCompareEnd) {
    ctx.addIssue({
      code: 'custom',
      path: ['compareStartDate'],
      message: 'compareStartDate and compareEndDate must both be provided together.',
    });
  } else if (hasCompareStart && hasCompareEnd) {
    if (!ISO_DATE_RE.test(val.compareStartDate!) || !ISO_DATE_RE.test(val.compareEndDate!)) {
      ctx.addIssue({
        code: 'custom',
        path: ['compareStartDate'],
        message: 'compareStartDate and compareEndDate must be in YYYY-MM-DD format.',
      });
    } else if (val.compareStartDate! > val.compareEndDate!) {
      ctx.addIssue({
        code: 'custom',
        path: ['compareStartDate'],
        message: 'compareStartDate must be on or before compareEndDate.',
      });
    }
  }
}

export const dateRangeBaseObject = z.object({
  startDate: isoDateString.describe('Start date of the reporting period (YYYY-MM-DD)'),
  endDate: isoDateString.describe('End date of the reporting period (YYYY-MM-DD)'),
  compareStartDate: z
    .string()
    .optional()
    .describe('Optional start date of the comparison period (YYYY-MM-DD)'),
  compareEndDate: z
    .string()
    .optional()
    .describe('Optional end date of the comparison period (YYYY-MM-DD)'),
});

export const dateRangeSchema = dateRangeBaseObject.superRefine(validateDateRangeObject);

export type DateRangeInput = z.infer<typeof dateRangeSchema>;

export const optionalDateRangeSchema = z
  .object({
    startDate: isoDateString.optional(),
    endDate: isoDateString.optional(),
    compareStartDate: z.string().optional(),
    compareEndDate: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.startDate || val.endDate) {
      if (!val.startDate || !val.endDate) {
        ctx.addIssue({
          code: 'custom',
          path: ['startDate'],
          message: 'Both startDate and endDate must be provided when filtering by date.',
        });
        return;
      }
      validateDateRangeObject(
        {
          startDate: val.startDate,
          endDate: val.endDate,
          compareStartDate: val.compareStartDate,
          compareEndDate: val.compareEndDate,
        },
        ctx
      );
    }
  });

export type OptionalDateRangeInput = z.infer<typeof optionalDateRangeSchema>;

export const trafficBreakdownDimensionSchema = z.enum([
  'channel',
  'sourceMedium',
  'referrer',
  'landingPage',
  'country',
  'device',
  'browser',
  'date',
]);

export const trafficBreakdownFiltersSchema = z
  .object({
    country: z.string().optional().describe('Optional exact country filter (e.g. Bangladesh)'),
    deviceCategory: z
      .string()
      .optional()
      .describe('Optional exact device category filter (desktop, mobile, tablet)'),
    browser: z.string().optional().describe('Optional exact browser filter (e.g. Chrome, Safari)'),
  })
  .optional();

export const trafficBreakdownInputSchema = dateRangeBaseObject
  .extend({
    dimension: trafficBreakdownDimensionSchema.describe(
      'Dimension to group traffic by: channel, sourceMedium, referrer, landingPage, country, device, browser, or date'
    ),
    filters: trafficBreakdownFiltersSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .optional()
      .describe('Maximum rows to return (default 50, max 500)'),
  })
  .superRefine(validateDateRangeObject);

export type TrafficBreakdownInput = z.infer<typeof trafficBreakdownInputSchema>;
