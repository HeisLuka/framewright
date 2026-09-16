export const processFrame = (packet, context) => {
  if (!packet || !(packet.rgba instanceof Uint8Array)) {
    throw new Error("identity post backend requires a frame packet");
  }
  if (packet.metadata?.frame !== context.frame) {
    throw new Error(
      `identity post metadata mismatch: packet=${packet.metadata?.frame} context=${context.frame}`,
    );
  }
  const expected = context.width * context.height * 4;
  if (packet.rgba.byteLength !== expected) {
    throw new Error(`identity post expected ${expected} bytes, got ${packet.rgba.byteLength}`);
  }
  return packet.rgba;
};

export default processFrame;
