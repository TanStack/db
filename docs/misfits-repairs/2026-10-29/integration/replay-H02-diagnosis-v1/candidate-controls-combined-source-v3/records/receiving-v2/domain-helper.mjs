import { evaluateReferenceExpression } from './reference-expression.mjs'
export function isCompletionFullDomainLoad(source, options, key) {
    if (options.limit !== undefined ||
        options.cursor !== undefined ||
        (options.offset ?? 0) !== 0)
        return false;
    const fields = source === `children` ? [`parent`] : [`rowId`, `id`];
    const onlyDomain = (expression) => {
        if (expression.type === `val`)
            return true;
        if (expression.type === `ref`)
            return (expression.path.length === 1 &&
                fields.includes(String(expression.path[0])));
        return expression.args.every(onlyDomain);
    };
    if (!options.where)
        return true;
    if (!onlyDomain(options.where))
        return false;
    return (evaluateReferenceExpression(options.where, source === `children` ? { parent: key } : { rowId: key, id: key }) === true);
}
