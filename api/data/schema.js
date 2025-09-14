// data/schema.js (CommonJS)
const { z } = require('zod');

const FaqItem = z
  .object({
    id: z.string().min(1).optional(),
    q: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
    a: z.string().min(1).optional(),
    answer: z.string().min(1).optional(),
    alt: z.array(z.string()).optional().default([]),
    tags: z.array(z.string()).optional().default([])
  })
  .refine(v => !!(v.q || v.question), { message: 'FAQ uten q/question' })
  .refine(v => !!(v.a || v.answer), { message: 'FAQ uten a/answer' });

const Company = z.object({
  navn: z.string().optional(), // norsk nøkkel beholdes
  byer: z.array(z.string()).optional(),
  adresser: z
    .object({
      tonsberg: z.string().optional(),
      oslo: z.string().optional()
    })
    .partial()
    .optional(),
  telefon: z.string().optional(),
  epost: z.string().optional(),
  apningstider: z
    .object({
      hverdager: z.string().optional(),
      lordag: z.string().optional(),
      sondag: z.string().optional()
    })
    .partial()
    .optional()
}).partial();

const Service = z.object({
  navn: z.string(),
  beskrivelse: z.string().optional()
});

const Prices = z.record(z.string()); // fleksibelt: key -> string

const Delivery = z.object({
  standard_dager: z.string().optional(),
  rush_mulig: z.boolean().optional(),
  rush_tillegg: z.string().optional()
}).partial();

const KnowledgeDoc = z.object({
  version: z.number().optional(),
  faq: z.array(FaqItem).optional().default([]),

  // meta-felt (norske eller engelske nøkler)
  firma: Company.optional(),
  company: Company.optional(),
  tjenester: z.array(Service).optional(),
  services: z.array(Service).optional(),
  priser: Prices.optional(),
  prices: Prices.optional(),
  levering: Delivery.optional(),
  delivery: Delivery.optional()
});

module.exports = { KnowledgeDoc };
