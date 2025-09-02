// CommonJS
const { z } = require('zod');

// En FAQ-post: stabil id anbefales, men kan genereres hvis mangler
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

const KnowledgeDoc = z.object({
  version: z.number().optional(),
  faq: z.array(FaqItem).optional().default([])
});

module.exports = { KnowledgeDoc };
