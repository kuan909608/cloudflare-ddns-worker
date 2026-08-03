import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '../views/DashboardView.vue';
import ClientDetailView from '../views/ClientDetailView.vue';
import ClientFormView from '../views/ClientFormView.vue';
import ClientListView from '../views/ClientListView.vue';
export default createRouter({history:createWebHistory(),routes:[
  {path:'/',component:DashboardView},{path:'/clients',component:ClientListView},{path:'/clients/new',component:ClientFormView},
  {path:'/clients/:id',component:ClientDetailView,props:true},{path:'/clients/:id/edit',component:ClientFormView,props:true},
]});
