import { ToastrService } from "ngx-toastr";
import { Component, OnInit } from "@angular/core";
import {
  CloudAppRestService,
  Request,
  HttpMethod,
  CloudAppConfigService,
  RestErrorResponse,
  Entity,
} from "@exlibris/exl-cloudapp-angular-lib";
import { catchError, finalize, mergeMap, switchMap, tap } from "rxjs/operators";
import { Configuration } from "../models/configuration.model";
import { EMPTY, from } from "rxjs";

const MAX_PARALLEL_QUERIES = 2;

@Component({
  selector: "app-main",
  templateUrl: "./main.component.html",
  styleUrls: ["./main.component.scss"],
})
export class MainComponent implements OnInit {
  files: File[] = [];
  barcodes: string[] = [];
  config: Configuration;
  loadingConfig: boolean = false;
  loadingBarcode: boolean = false;
  scanInList: { title: string; additional_info: string; barcode: string }[] = [];
  errorInList: { message: string; barcode: string }[] = [];
  showProgress: boolean = true;
  processed: number = 0;

  constructor(
    private restService: CloudAppRestService,
    private toaster: ToastrService,
    private configService: CloudAppConfigService
  ) {}

  ngOnInit() {
    this.loadingConfig = true;
    this.configService.get().subscribe({
      next: (res: Configuration) => {
        if (res && Object.keys(res).length !== 0) {
          this.config = res;
        }
        this.loadingConfig = false;
      },
      error: (err: Error) => {
        this.toaster.error(err.message);
        console.error(err.message);
        this.loadingConfig = false;
      },
    });
  }

  onSelect(event) {
    this.loadingBarcode = true;
    this.barcodes = [];
    this.files = [];
    this.processed = 0;
    event.addedFiles.forEach((file: File) => {
      file
        .text()
        .then<void>((barcodes: string): void => {
          this.barcodes.push(...barcodes.split(/\r?\n/).filter((e) => e));
          this.onNewBarcodes();
        })
        .catch((reason) => {
          this.toaster.error("Could not load file :" + reason);
          Promise.reject(reason);
        });
    });
    this.files.push(...event.addedFiles);
  }

  onRemove(event) {
    console.log(event);
    this.files.splice(this.files.indexOf(event), 1);
  }
  private onNewBarcodes() {
    let allResults = [];
    let observables = Array.from(this.barcodes, (barcode) => this.getByBarcode(barcode));
    from(observables)
      .pipe(
        mergeMap((observable) => observable, MAX_PARALLEL_QUERIES),
        finalize(() => {
          this.loadingBarcode = false;
        })
      )
      .subscribe({
        next: (partialResults) => {
          allResults = allResults.concat(partialResults);
        },
        error: (err) => console.log("Error", err),
        complete: () => {
          allResults.forEach((val) =>
            this.scanInList.push({
              title: val.bib_data.title,
              additional_info: val.additional_info,
              barcode: val.item_data.barcode,
            })
          );
        },
      });
  }

  private getByBarcode(barcode: string) {
    return this.restService.call("/items?item_barcode=" + barcode).pipe(
      tap(() => this.processed++),
      catchError((e: RestErrorResponse) => {
        console.error(e.message);
        this.errorInList.unshift({ barcode: barcode, message: e.message });
        return EMPTY;
      }),

      switchMap((res) => {
        let queryParams = { op: "scan", ...this.config.mustConfig, ...this.config?.from };
        queryParams.department !== ""
          ? (queryParams = { ...queryParams, ...this.config.departmentArgs })
          : null;
        let requst: Request = {
          url: res.link,
          method: HttpMethod.POST,
          queryParams,
        };
        return this.restService.call(requst).pipe(
          catchError((e: RestErrorResponse) => {
            console.error(e.message);
            this.errorInList.unshift({ barcode: barcode, message: e.message });
            return EMPTY;
          })
        );
      })
    );
  }
  get percentComplete() {
    let len = this.barcodes.length !== 0 ? this.barcodes.length : this.processed;
    return Math.round((this.processed / len) * 100);
  }
}
