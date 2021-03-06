import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Injectable, OnDestroy } from "@angular/core";
import { Observable, of, Subject, Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { Item } from "src/app/pedido/item";
import { Pedido, PedidoBuilder } from "src/app/pedido/pedido";
import { environment } from "src/environments/environment";
import { MqttService, Topic } from "../utils/mqtt.service";
import { Message } from "paho-mqtt";

@Injectable({
  providedIn: "root",
})
export class PedidoService implements OnDestroy {

  private subscriptions: Subscription;
  private endpoint: string;
  private headers: HttpHeaders;
  
  private pedido: Pedido;
  public pedidoSubject: Subject<Pedido>;
  public pedido$: Observable<Pedido>;

  private pedidosSubject: Subject<Array<Pedido>>;
  public pedidos$: Observable<Array<Pedido>>;

  constructor(private http: HttpClient, private mqttService: MqttService) {
    this.subscriptions = new Subscription();
    this.endpoint = `${environment.API_HOST}/pedidos`;
    this.headers = new HttpHeaders({
      "Content-Type": "application/json",
      "Accept": "application/json",
    });

    this.pedido = null;
    this.pedidoSubject = new Subject<Pedido>();
    this.pedido$ = this.pedidoSubject.asObservable();

    this.pedidosSubject = new Subject<Array<Pedido>>();
    this.pedidos$ = this.pedidosSubject.asObservable();
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  createPedido(mesa: string): void {
    this.subscriptions.add(this.getSigCodigo().subscribe((codigo: string) => {
      const fecha = new Date();
      const newPedido: Pedido = new PedidoBuilder()
        .withFecha(new Date(Number(fecha) - (fecha.getTimezoneOffset() * 60 * 1000)).toISOString())
        .withCodigo(codigo)
        .withItems([])
        .withMesa(mesa)
        .withTotal(0)
        .withPago(false)
        .build();

      this.subscriptions.add(this.http.post<Pedido>(`${this.endpoint}`, newPedido, { headers: this.headers }).subscribe((pedido: Pedido) => {
        this.pedido = pedido;
        this.pedido.fecha = this.pedido.fecha.split(".")[0];
        this.pedidoSubject.next(this.pedido);
        this.mqttService.publish(Topic.Servicio, JSON.stringify({method: PedidoServiceActions.AddPedido, pedido: this.pedido.codigo, fecha: this.pedido.fecha}));
      }));
    }));
  }

  deletePedido(): void {
    const tmpPedido: string = this.pedido.codigo;
    const tmpFecha: string = this.pedido.fecha;
    this.subscriptions.add(this.http.delete<void>(`${this.endpoint}/${this.pedido.codigo}/${this.pedido.fecha}`).subscribe((_) => {
      this.pedido = new Pedido();
      this.pedido.items = [];
      this.pedidoSubject.next(this.pedido);
      this.mqttService.publish(Topic.Servicio, JSON.stringify({method: PedidoServiceActions.DeletePedido, pedido: tmpPedido, fecha: tmpFecha}));
    }));
  }

  getPedidos(): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(`${this.endpoint}?pago=false`);
  }

  fetchPedidos(): void {
    this.subscriptions.add(this.http.get<Pedido[]>(`${this.endpoint}?pago=false`).subscribe((pedidos: Array<Pedido>) => {
      this.pedidosSubject.next(pedidos);
    }));
  }

  getPedido(codigo: string, fecha: string): Observable<Pedido> {
    return this.http.get<Pedido>(`${this.endpoint}/${codigo}/${fecha}`);
  }

  changePedido(pedido: Pedido): void {
    this.pedido = pedido;
    this.pedidoSubject.next(this.pedido);
  }

  addItem(item: Item): void{
    this.subscriptions.add(this.http.post<Pedido>(`${this.endpoint}/${this.pedido.codigo}/${this.pedido.fecha}/items/productos/${item.producto.codigo}`, item, { headers: this.headers }).subscribe((pedido: Pedido) => {
      this.pedido = pedido;
      this.pedidoSubject.next(this.pedido);
      this.mqttService.publish(Topic.Servicio, JSON.stringify({method: PedidoServiceActions.AddItem, pedido: this.pedido.codigo, fecha: this.pedido.fecha}));
    }));
  }

  deleteItem(item: Item): void {
    this.http.delete<Pedido>(`${this.endpoint}/${this.pedido.codigo}/${this.pedido.fecha}/items/${item.numero}`).subscribe((pedido: Pedido) => {
      this.pedido = pedido;
      this.pedidoSubject.next(this.pedido);
      this.mqttService.publish(Topic.Servicio, JSON.stringify({method: PedidoServiceActions.DeleteItem, pedido: this.pedido.codigo, fecha: this.pedido.fecha}));
    });
  }

  getSigCodigo(): Observable<string> {
    return this.http.get<string>(
      `${this.endpoint}/codigo/next`,
      { headers: new HttpHeaders({"Content-Type": "text/plain",  "Accept": "text/plain"}),
        responseType: "text" as "json" });
  }

  pagar(pedido: Pedido): void {
    pedido.pago = true;
    this.subscriptions.add(this.http.put<void>(`${this.endpoint}/${pedido.codigo}/${pedido.fecha}`, pedido, { headers: this.headers }).subscribe((_) => {
      this.fetchPedidos();
      this.mqttService.publish(Topic.Servicio, JSON.stringify({method: PedidoServiceActions.PayPedido, pedido: pedido.codigo, fecha: pedido.fecha}));
    }));
  }

  cambiarEstadoItem(item: Item): void {
    this.subscriptions.add(this.http.put<void>(`${this.endpoint}/${this.pedido.codigo}/${this.pedido.fecha}/items/${item.numero}`, item, {headers: this.headers}).subscribe((_) => {
      this.mqttService.publish(Topic.Servicio, JSON.stringify({method: PedidoServiceActions.ChangeItemState, pedido: this.pedido.codigo, fecha: this.pedido.fecha, item}));
    }));
  }
}

export enum PedidoServiceActions {
  AddItem = 0,
  DeleteItem,
  ChangeItemState,
  AddPedido,
  DeletePedido,
  PayPedido
};
