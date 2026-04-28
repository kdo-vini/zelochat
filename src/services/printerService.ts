import type { Order } from '../types';

const LINE_WIDTH = 32;

class EscPosBuilder {
  private buf: number[] = [];

  init()               { this.buf.push(0x1B, 0x40); return this; }
  center()             { this.buf.push(0x1B, 0x61, 0x01); return this; }
  left()               { this.buf.push(0x1B, 0x61, 0x00); return this; }
  bold(on: boolean)    { this.buf.push(0x1B, 0x45, on ? 0x01 : 0x00); return this; }
  double(on: boolean)  { this.buf.push(0x1B, 0x21, on ? 0x30 : 0x00); return this; }
  feed(n = 3)          { for (let i = 0; i < n; i++) this.buf.push(0x0A); return this; }
  cut()                { this.buf.push(0x1D, 0x56, 0x41, 0x00); return this; }

  text(str: string) {
    new TextEncoder().encode(str).forEach((b) => this.buf.push(b));
    return this;
  }

  line(str = '') { return this.text(str + '\n'); }

  sep(char = '-') { return this.line(char.repeat(LINE_WIDTH)); }

  row(label: string, value: string) {
    const gap = LINE_WIDTH - label.length - value.length;
    return this.line(label + (gap > 0 ? ' '.repeat(gap) : ' ') + value);
  }

  build() { return new Uint8Array(this.buf); }
}

function fmtMoney(n: number): string {
  return `R$${n.toFixed(2).replace('.', ',')}`;
}

async function claimDevice(device: USBDevice): Promise<{ ep: number; iface: number }> {
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);

  for (const iface of device.configuration!.interfaces) {
    for (const alt of iface.alternates) {
      const ep = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (ep) {
        await device.claimInterface(iface.interfaceNumber);
        return { ep: ep.endpointNumber, iface: iface.interfaceNumber };
      }
    }
  }

  await device.close();
  throw new Error('Impressora não suportada — nenhum endpoint de saída encontrado.');
}

export function isPrinterSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

export async function connectPrinter(): Promise<USBDevice> {
  // Class 7 = printer; 0xFF = vendor-specific (covers many thermal printers)
  return navigator.usb.requestDevice({
    filters: [{ classCode: 7 }, { classCode: 0xFF }],
  });
}

export async function getStoredPrinter(): Promise<USBDevice | null> {
  const devices = await navigator.usb.getDevices();
  return devices[0] ?? null;
}

export async function printOrder(
  device: USBDevice,
  order: Order,
  businessName = 'ZeloChat',
): Promise<void> {
  const { ep, iface } = await claimDevice(device);

  try {
    const shortId = order.id.slice(-8).toUpperCase();
    const b = new EscPosBuilder()
      .init()
      .center().bold(true).double(true)
      .line(businessName.slice(0, 16).toUpperCase())
      .double(false).bold(false)
      .sep('=')
      .left()
      .line(`Pedido #${shortId}`)
      .line(`Cliente: ${order.customerName}`)
      .line(`Tel: ${order.customerPhone || '-'}`)
      .sep();

    for (const item of order.items) {
      b.line(`${item.quantity}x ${item.product}`);
    }

    b.sep()
      .bold(true).row('TOTAL:', fmtMoney(order.total)).bold(false)
      .line(`Pagamento: ${order.paymentMethod || '-'}`);

    if (order.deliveryAddress) {
      b.line(`Entrega:`).line(`  ${order.deliveryAddress}`);
    } else {
      b.line(`Retirada: ${order.pickupTime}`);
    }

    b.feed(4).cut();

    await device.transferOut(ep, b.build());
  } finally {
    await device.releaseInterface(iface);
    await device.close();
  }
}

export async function printDayReport(
  device: USBDevice,
  dateLabel: string,
  orders: Order[],
  businessName = 'ZeloChat',
): Promise<void> {
  const { ep, iface } = await claimDevice(device);

  try {
    const b = new EscPosBuilder()
      .init()
      .center().bold(true).double(true)
      .line(businessName.slice(0, 16).toUpperCase())
      .double(false).bold(false)
      .sep('=')
      .line('PEDIDOS DO DIA')
      .line(dateLabel)
      .line(`Total de pedidos: ${orders.length}`)
      .sep()
      .left();

    let totalGeral = 0;

    for (const order of orders) {
      const shortId = order.id.slice(-8).toUpperCase();
      b.bold(true).line(`[${order.pickupTime}] ${order.customerName.slice(0, 20)}`).bold(false)
       .line(`Ped #${shortId} | ${order.status}`);
      
      for (const item of order.items) {
        b.line(`  ${item.quantity}x ${item.product.slice(0, 26)}`);
      }
      
      if (order.deliveryAddress) {
        b.line(`  📍 Entrega`);
      }
      
      b.row('  Total:', fmtMoney(order.total))
       .sep('-');
       
      totalGeral += order.total;
    }

    b.bold(true).row('TOTAL GERAL:', fmtMoney(totalGeral)).bold(false)
     .feed(4).cut();

    await device.transferOut(ep, b.build());
  } finally {
    await device.releaseInterface(iface);
    await device.close();
  }
}
