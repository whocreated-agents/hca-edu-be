import { Controller, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DOCUMENT_MAX_BYTES, routes, type BodyOut, type ParamsOut } from '@hca/contracts';
import { Endpoint, Input, Parsed } from '../common/endpoint';
import { Problem } from '../common/problem';
import { AdmissionService } from './admission.service';

const r = routes.public;

/**
 * Public (anonymous) admission surface: stage-1 enquiry and stage-2 tokenised application. The
 * remaining `public.*` routes (profile/content/notices/fees/session/class-levels) live on
 * PublicController; this controller owns only the admission-shaped ones so AdmissionService stays
 * the single place that resolves an application-access token.
 */
@Controller()
export class AdmissionController {
  constructor(private readonly admission: AdmissionService) {}

  @Endpoint(r.createEnquiry)
  createEnquiry(@Input() { body }: Parsed<unknown, unknown, BodyOut<typeof r.createEnquiry>>) {
    return this.admission.createEnquiry(body);
  }

  @Endpoint(r.getApplication)
  getApplication(@Input() { params }: Parsed<ParamsOut<typeof r.getApplication>>) {
    return this.admission.getApplication(params.token);
  }

  @Endpoint(r.submitApplication)
  submitApplication(@Input() { params, body }: Parsed<ParamsOut<typeof r.submitApplication>, unknown, BodyOut<typeof r.submitApplication>>) {
    return this.admission.submitApplication(params.token, body);
  }

  @Endpoint(r.uploadApplicationDocument)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES } }))
  uploadApplicationDocument(
    @Input() { params, body }: Parsed<ParamsOut<typeof r.uploadApplicationDocument>, unknown, BodyOut<typeof r.uploadApplicationDocument>>,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file) throw new Problem({ status: 400, code: 'VALIDATION_FAILED', detail: 'A file is required' });
    return this.admission.uploadApplicationDocument(params.token, body.kind, file);
  }

  @Endpoint(r.deleteApplicationDocument)
  deleteApplicationDocument(@Input() { params }: Parsed<ParamsOut<typeof r.deleteApplicationDocument>>) {
    return this.admission.deleteApplicationDocument(params.token, params.docId);
  }
}
