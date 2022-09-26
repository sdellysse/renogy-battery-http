import ModbusRTU from "modbus-serial";

export const uniqueStrings = (items: Array<string>) => {
  const obj: Record<string, unknown> = {};
  for (const item of items) {
    obj[item] = true;
  }
  return Object.keys(obj);
};

export const log = Object.assign(
  (level: string, message: string) =>
    console.log(`${new Date().toISOString()} [${level}] ${message}`),
  {
    info: (message: string) => log("INFO", message),
    warn: (message: string) => log("WARN", message),
    error: (message: string) => log("ERROR", message),
  }
);

type queryModbusFnBag = {
  numberAt: (
    register: number,
    length: 1 | 2,
    signed: "signed" | "unsigned"
  ) => number;
  asciiAt: (register: number, length: number) => string;
};
export const queryModbus = async <Out>(
  modbusConn: ModbusRTU,
  server: number,
  startRegister: number,
  upToRegister: number,
  fn: (bag: queryModbusFnBag) => Out | Promise<Out>
) => {
  modbusConn.setID(server);

  const data = (
    await modbusConn.readHoldingRegisters(
      startRegister,
      upToRegister - startRegister
    )
  ).buffer;

  const offsetOf = (register: number) => {
    if (register < startRegister) {
      throw new Error(`bad register: ${register}`);
    }

    return (register - startRegister) * 2;
  };

  const asciiEndRegisterOf = (register: number, length: number) =>
    offsetOf(register) + length * 2;

  const trimNullCharacters = (input: string) => input.replace(/\x00+$/, "");

  const bag: queryModbusFnBag = {
    numberAt: (register, length, signed) => {
      const fnMap = <const>{
        "1": {
          unsigned: (register: number) => data.readUInt16BE(offsetOf(register)),
          signed: (register: number) => data.readInt16BE(offsetOf(register)),
        },
        "2": {
          unsigned: (register: number) => data.readUInt32BE(offsetOf(register)),
          signed: (register: number) => data.readInt32BE(offsetOf(register)),
        },
      };

      const fn = fnMap[`${length}`][`${signed}`];
      return fn(register);
    },

    asciiAt: (register, length) => {
      return trimNullCharacters(
        data.toString(
          "ascii",
          offsetOf(register),
          asciiEndRegisterOf(register, length)
        )
      );
    },
  };

  const fnResult = fn(bag);
  return fnResult instanceof Promise ? await fnResult : fnResult;
};

type runForever<Setup> = {
  setup: () => Promise<Setup>;
  teardown: (setup: Setup) => Promise<void>;
  loop: (setup: Setup) => Promise<void>;
};
export const runForever = async <Setup>({
  setup,
  teardown,
  loop,
}: runForever<Setup>) => {
  for (;;) {
    let setupBag: Setup;
    try {
      setupBag = await setup();
    } catch (error) {
      log.error(`Error in setup: ${JSON.stringify(error)}`);
      continue;
    }

    try {
      for (;;) {
        await loop(setupBag);
      }
    } catch (error) {
      log.error(`Error in loop: ${JSON.stringify(error)}`);
      await teardown(setupBag);
    }
  }
};