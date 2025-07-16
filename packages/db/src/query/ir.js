/*
This is the intermediate representation of the query.
*/
/* Expressions */
class BaseExpression {
}
export class CollectionRef extends BaseExpression {
    constructor(collection, alias) {
        super();
        this.collection = collection;
        this.alias = alias;
        this.type = `collectionRef`;
    }
}
export class QueryRef extends BaseExpression {
    constructor(query, alias) {
        super();
        this.query = query;
        this.alias = alias;
        this.type = `queryRef`;
    }
}
export class PropRef extends BaseExpression {
    constructor(path // path to the property in the collection, with the alias as the first element
    ) {
        super();
        this.path = path;
        this.type = `ref`;
    }
}
export class Value extends BaseExpression {
    constructor(value // any js value
    ) {
        super();
        this.value = value;
        this.type = `val`;
    }
}
export class Func extends BaseExpression {
    constructor(name, // such as eq, gt, lt, upper, lower, etc.
    args) {
        super();
        this.name = name;
        this.args = args;
        this.type = `func`;
    }
}
export class Aggregate extends BaseExpression {
    constructor(name, // such as count, avg, sum, min, max, etc.
    args) {
        super();
        this.name = name;
        this.args = args;
        this.type = `agg`;
    }
}
