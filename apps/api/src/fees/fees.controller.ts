import { Controller } from '@nestjs/common';
import { routes, type BodyOut, type ParamsOut, type QueryOut } from '@hca/contracts';
import { Endpoint, Input, Me, Parsed, Principal, Req, type HcaRequest } from '../common/endpoint';
import { FeesService } from './fees.service';

const r = routes.adminFees;

/** Admin control plane: fee heads, class-wise structure, invoices, office-recorded payments. */
@Controller()
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  @Endpoint(r.feeHeads)
  feeHeads() {
    return this.fees.feeHeads();
  }

  @Endpoint(r.createFeeHead)
  createFeeHead(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.createFeeHead>>) {
    return this.fees.createFeeHead(body);
  }

  @Endpoint(r.updateFeeHead)
  updateFeeHead(@Input() { params, body }: Parsed<ParamsOut<typeof r.updateFeeHead>, unknown, BodyOut<typeof r.updateFeeHead>>) {
    return this.fees.updateFeeHead(params.id, body);
  }

  @Endpoint(r.deleteFeeHead)
  deleteFeeHead(@Input() { params }: Parsed<ParamsOut<typeof r.deleteFeeHead>>) {
    return this.fees.deleteFeeHead(params.id);
  }

  @Endpoint(r.structure)
  structure(@Input() { query }: Parsed<unknown, QueryOut<typeof r.structure>>) {
    return this.fees.structure(query);
  }

  @Endpoint(r.putStructure)
  putStructure(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.putStructure>>) {
    return this.fees.putStructure(body);
  }

  @Endpoint(r.invoices)
  invoices(@Input() { query }: Parsed<unknown, QueryOut<typeof r.invoices>>) {
    return this.fees.invoices(query);
  }

  @Endpoint(r.invoice)
  invoice(@Input() { params }: Parsed<ParamsOut<typeof r.invoice>>) {
    return this.fees.invoice(params.id);
  }

  @Endpoint(r.generateInvoices)
  generateInvoices(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.generateInvoices>>) {
    return this.fees.generateInvoices(body);
  }

  @Endpoint(r.waiveInvoice)
  waiveInvoice(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.waiveInvoice>, unknown, BodyOut<typeof r.waiveInvoice>>) {
    return this.fees.waiveInvoice(me, params.id, body.reason, req.ip ?? null);
  }

  @Endpoint(r.payments)
  payments(@Input() { query }: Parsed<unknown, QueryOut<typeof r.payments>>) {
    return this.fees.payments(query);
  }

  @Endpoint(r.payment)
  payment(@Input() { params }: Parsed<ParamsOut<typeof r.payment>>) {
    return this.fees.payment(params.id);
  }

  @Endpoint(r.recordPayment)
  recordPayment(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.recordPayment>, unknown, BodyOut<typeof r.recordPayment>>) {
    return this.fees.recordPayment(me, params.id, body, req.ip ?? null);
  }

  @Endpoint(r.voidPayment)
  voidPayment(@Me() me: Principal, @Req() req: HcaRequest, @Input() { params, body }: Parsed<ParamsOut<typeof r.voidPayment>, unknown, BodyOut<typeof r.voidPayment>>) {
    return this.fees.voidPayment(me, params.id, body.reason, req.ip ?? null);
  }
}
