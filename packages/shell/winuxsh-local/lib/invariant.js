export const name = 'winuxsh-local-invariant'
export const inject = ['invariants']
export const apply = (ctx) => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-winuxsh-local', () => {}))
