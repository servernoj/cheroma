const handler = (req, res, next) => {
    const parser = (data) => {
        if (typeof data !== "string") {
            return data;
        }
        const str = data;
        if (str.toLowerCase() === "true" || str === "1" || str === "") {
            return true;
        } else if (str.toLowerCase() === "false" || str === "0") {
            return false;
        } else {
            const num = Number(str);
            if (!isNaN(num)) {
                return num;
            }
        }
        return str;
    };
    const parsedQuery = Object.entries(req.query)
        .map(
            ([k, v]) => [
                k.toLowerCase(),
                Array.isArray(v) ? v.map(parser) : parser(v)
            ]
        )
        .reduce(
            (a, [k, v]) => {
                if (k in a) {
                    if (!Array.isArray(a[k])) {
                        a[k] = [a[k]];
                    }
                    a[k].push(v);
                } else {
                    a[k] = v;
                }
                return a;
            },
            {}
        );
    req.parsedQuery = parsedQuery;
    next();
};

export default handler;
