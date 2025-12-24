import { NotFoundError } from "http-errors-enhanced";

export default (req, res, next) => {
    throw new NotFoundError("Not found");
};
