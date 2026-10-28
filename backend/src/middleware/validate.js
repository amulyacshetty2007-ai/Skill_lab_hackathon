// validate({ body, query, params }) parses with zod and REPLACES the raw value with the parsed one,
// so handlers only ever see validated, typed data (and unknown keys are dropped or rejected by .strict()).
export const validate = (schemas) => (req, _res, next) => {
  try {
    for (const part of ['params', 'query', 'body']) {
      if (schemas[part]) req[part] = schemas[part].parse(req[part] ?? {});
    }
    next();
  } catch (e) { next(e); }
};
