import { isHttpError } from "http-errors-enhanced";

const handler = (err, req, res, next) => {
    let responseObject, responseStatus;
    if (isHttpError(err)) {
        /**
         * @type {Record<string,any>}
         */
        const details = err.serialize(
            true,
            true
        );
        responseObject = {
            execStatus: false,
            httpStatus: err.status,
            msg: err.message,
            data: details?.errorDetails ?? details ?? null
        };
        responseStatus = err.status;
        console.dir(details, {
            colors: true,
            depth: null
        });
    } else {
        responseStatus = 500;
        responseObject = {
            execStatus: false,
            httpStatus: responseStatus,
            msg: "Unknown server error"
        };
        console.error(err.message);
    }
    res.status(responseStatus).json(responseObject);
};

export default handler;