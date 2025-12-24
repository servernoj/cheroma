import { BadRequestError } from "http-errors-enhanced";
import { isEmpty, toPairs } from "lodash-es";

const getDataExtractor = req => key => {
    switch (key) {
        case "query":
            return req.parsedQuery ?? req.query;
        case "params":
            return req.params;
        case "body":
            return req.body;
        case "headers":
            return req.headers;
    }
};

const handler = schema => {
    return (req, res, next) => {
        const dataExtractor = getDataExtractor(req);
        const result = toPairs(schema).reduce(
            (a, [key, value]) => {
                if (!isEmpty(schema[key])) {
                    const result = value.safeParse(dataExtractor(key));
                    if (result.success) {
                        a.data[key] = result.data;
                    } else {
                        a.errors[key] = result.error.issues;
                    }
                }
                return a;
            },
            {
                data: {},
                errors: {}
            }
        );
        if (isEmpty(result.errors)) {
            if (!res.locals.parsed) {
                res.locals.parsed = {};
            }
            Object.entries(result.data).forEach(
                ([key, value]) => {
                    Object.assign(res.locals.parsed, {
                        [key]: value
                    });
                }
            );
            next();
        } else {
            next(new BadRequestError("Invalid request", result.errors));
        }
    };
};

export default handler;
